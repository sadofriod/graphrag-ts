import { createHash } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { parseAccessPolicy, type AccessAccount } from './access.ts';
import { loadConfig } from './config.ts';
import { createHttpHandler, startMcpServer, type McpSession } from './mcp.ts';
import { createStore, type IndexStore } from './store.ts';
import { createLogger } from './log.ts';

const tokens = { alpha: 'alpha-test-credential-1234567890123456', beta: 'beta-test-credential-12345678901234567' };
const accounts: AccessAccount[] = Object.entries(tokens).map(([id, token]) => ({
  id, plan: 'evaluation', api_key_sha256: createHash('sha256').update(token).digest('hex'),
  workspaces: [id], operations: ['index', 'query', 'read'],
  monthly_limits: { index: 1, query: 1, global_query: 0 }, expires_at: '2099-01-01T00:00:00Z',
}));
const logger = createLogger('error');
const config = loadConfig({ DATABASE_URL: 'postgresql://localhost/unused' });

const fixture = (hosted = true, overrides: Partial<IndexStore> = {}) => {
  const usage = new Map<string, number>();
  let enqueued = 0;
  const store: IndexStore = {
    ...createStore(config.DATABASE_URL),
    ping: async () => undefined,
    consumeUsage: async (id, operation, limit) => {
      const key = `${id}:${operation}`;
      const used = usage.get(key) ?? 0;
      if (used >= limit) return false;
      usage.set(key, used + 1);
      return true;
    },
    getUsage: async () => ({ period: '2026-10', usage: [{ operation: 'query', units: 1 }] }),
    listWorkspaces: async () => ['alpha', 'beta'],
    getGraphSnapshot: async () => ({ versionId: null, nodes: [], edges: [] }),
    listJobs: async () => [],
    listJobLogs: async () => [],
    listRetrievalLogs: async () => [],
    getJob: async () => null,
    enqueue: async () => { enqueued++; return { id: 'a-job', queuePosition: 1 }; },
    acquireActiveVersionLease: async () => null,
    appendActivityLog: async () => undefined,
    ...overrides,
  };
  const sessions = new Map<string, McpSession>();
  const handler = createHttpHandler(store, config, logger, sessions, undefined,
    hosted ? parseAccessPolicy({ accounts }) : undefined);
  const request = (path: string, token?: string, init: RequestInit = {}) => handler(new Request(`http://localhost${path}`, {
    ...init,
    headers: { host: 'localhost', ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers },
  }));
  return {
    request, handler, store, enqueued: () => enqueued, usage,
    close: async () => { await Promise.all([...sessions.values()].map((session) => session.server.close())); await store.close(); },
  };
};

type Fixture = ReturnType<typeof fixture>;
const rpc = (app: Fixture, token: string, method: string, params: unknown, session?: string) =>
  app.request('/mcp', token, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', accept: 'application/json, text/event-stream',
      ...(session ? { 'mcp-session-id': session } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });

const initialize = async (app: Fixture, token: string): Promise<string> => {
  const response = await rpc(app, token, 'initialize', {
    protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' },
  });
  expect(response.status).toBe(200);
  await response.text();
  const id = response.headers.get('mcp-session-id');
  if (!id) throw new Error('Missing MCP session ID');
  return id;
};

describe('hosted HTTP boundary and MCP protocol', () => {
  test('supports the official SDK over loopback HTTP through session termination', async () => {
    const app = fixture();
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: app.handler });
    const client = new Client({ name: 'hosted-smoke-test', version: '1' });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${tokens.alpha}` } },
    });
    try {
      // The SDK getter permits undefined, unlike its exact-optional Transport declaration.
      await client.connect(transport as Transport);
      expect((await client.listTools()).tools.map((tool) => tool.name)).toContain('remember_text');
      const result = await client.callTool({
        name: 'remember_text', arguments: { workspace_id: 'alpha', text: 'Explicit SDK smoke-test input' },
      });
      expect(result.isError).not.toBe(true);
      expect(app.enqueued()).toBe(1);
      await transport.terminateSession();
    } finally {
      await client.close();
      server.stop(true);
      await app.close();
    }
  });

  test('requires auth on all data routes, but leaves readiness public', async () => {
    const app = fixture();
    try {
      expect((await app.request('/healthz')).status).toBe(200);
      for (const path of ['/mcp', '/api/usage', '/api/workspaces', '/api/workspaces/alpha/graph']) {
        const response = await app.request(path);
        expect(response.status).toBe(401);
        expect(response.headers.get('www-authenticate')).toContain('Bearer');
        expect((await app.request(path, 'x'.repeat(40))).status).toBe(401);
      }
      expect((await app.request('/api/workspaces', tokens.alpha, { headers: { host: 'evil.example' } })).status).toBe(403);
    } finally { await app.close(); }
  });

  test('filters workspace listing, scopes every dashboard surface and returns private usage', async () => {
    const app = fixture();
    try {
      expect(await (await app.request('/api/workspaces', tokens.alpha)).json()).toEqual({ workspaces: ['alpha'] });
      for (const path of ['graph', 'jobs', 'jobs/00000000-0000-4000-8000-000000000000/logs', 'retrieval-logs']) {
        expect((await app.request(`/api/workspaces/beta/${path}`, tokens.alpha)).status).toBe(403);
        expect((await app.request(`/api/workspaces/alpha/${path}`, tokens.alpha)).status).toBe(200);
      }
      const response = await app.request('/api/usage', tokens.alpha);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toMatchObject({
        account_id: 'alpha', plan: 'evaluation', unit: 'admitted_tool_attempt',
        usage: [
          { operation: 'index', used: 0, limit: 1, remaining: 1 },
          { operation: 'query', used: 1, limit: 1, remaining: 0 },
          { operation: 'global_query', used: 0, limit: 0, remaining: 0 },
        ],
      });
      expect((await app.request('/api/usage', tokens.alpha, { method: 'POST' })).status).toBe(405);
    } finally { await app.close(); }
  });

  test('binds sessions to identity and gates every MCP tool before side effects', async () => {
    const app = fixture();
    try {
      const session = await initialize(app, tokens.alpha);
      expect((await rpc(app, tokens.beta, 'tools/list', {}, session)).status).toBe(404);
      expect((await rpc(app, tokens.alpha, 'tools/list', {}, session)).status).toBe(200);
      for (const [name, args] of [
        ['remember_text', { text: 'hello' }],
        ['submit_index_job', { path: '.' }],
        ['query_graph', { query: 'hello' }],
        ['query_graph_global', { query: 'hello' }],
        ['get_index_job', { job_id: '00000000-0000-4000-8000-000000000000' }],
      ] as const) {
        const response = await rpc(app, tokens.alpha, 'tools/call',
          { name, arguments: { ...args, workspace_id: 'beta' } }, session);
        expect(await response.text()).toContain('FORBIDDEN');
      }
      expect(app.enqueued()).toBe(0);
      expect(app.usage.size).toBe(0);
      const deniedPath = await rpc(app, tokens.alpha, 'tools/call',
        { name: 'submit_index_job', arguments: { workspace_id: 'alpha', path: '.' } }, session);
      expect(await deniedPath.text()).toContain('FORBIDDEN');
    } finally { await app.close(); }
  });

  test('meters ingestion and queries across sessions; failed attempts count and denied plans do not', async () => {
    const app = fixture();
    try {
      const first = await initialize(app, tokens.alpha);
      const second = await initialize(app, tokens.alpha);
      const ingest = { name: 'remember_text', arguments: { workspace_id: 'alpha', text: '# Original text' } };
      expect(await (await rpc(app, tokens.alpha, 'tools/call', ingest, first)).text()).toContain('queued');
      expect(await (await rpc(app, tokens.alpha, 'tools/call', ingest, second)).text()).toContain('QUOTA_EXCEEDED');
      expect(app.enqueued()).toBe(1);
      const query = { name: 'query_graph', arguments: { workspace_id: 'alpha', query: 'hello' } };
      expect(await (await rpc(app, tokens.alpha, 'tools/call', query, first)).text()).toContain('INDEX_NOT_READY');
      expect(await (await rpc(app, tokens.alpha, 'tools/call', query, second)).text()).toContain('QUOTA_EXCEEDED');
      const global = { name: 'query_graph_global', arguments: query.arguments };
      expect(await (await rpc(app, tokens.alpha, 'tools/call', global, second)).text()).toContain('FORBIDDEN');
      expect(app.usage.get('alpha:global_query')).toBeUndefined();
    } finally { await app.close(); }
  });

  test('preserves unauthenticated local mode and disallows authenticated stdio', async () => {
    const app = fixture(false);
    try {
      expect(await (await app.request('/api/workspaces')).json()).toEqual({ workspaces: ['alpha', 'beta'] });
      expect((await app.request('/api/usage')).status).toBe(404);
      await expect(startMcpServer(app.store, { ...config, MCP_TRANSPORT: 'stdio', MCP_ACCESS_FILE: 'missing.json' }, logger))
        .rejects.toThrow('requires HTTP');
    } finally { await app.close(); }
  });

  test('does not enqueue when metering persistence fails', async () => {
    const app = fixture(true, { consumeUsage: async () => { throw new Error('offline'); } });
    try {
      const session = await initialize(app, tokens.alpha);
      const response = await rpc(app, tokens.alpha, 'tools/call', {
        name: 'remember_text', arguments: { workspace_id: 'alpha', text: 'hello' },
      }, session);
      expect(await response.text()).toContain('INTERNAL_ERROR');
      expect(app.enqueued()).toBe(0);
    } finally { await app.close(); }
  });
});
