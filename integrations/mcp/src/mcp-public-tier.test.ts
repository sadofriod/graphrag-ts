import { createHash } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import { parseAccessPolicy, type AccessAccount } from './access.ts';
import { loadConfig } from './config.ts';
import { createHttpHandler, type McpSession } from './mcp.ts';
import { createStore, type IndexStore } from './store.ts';
import { createLogger } from './log.ts';
import type { McpToolOptions } from './mcp/tools.ts';
import type { Judge } from './integrity/judge.ts';

const tokens = { alpha: 'alpha-test-credential-1234567890123456', beta: 'beta-test-credential-12345678901234567' };
const accounts: AccessAccount[] = Object.entries(tokens).map(([id, token]) => ({
  id, plan: 'evaluation', api_key_sha256: createHash('sha256').update(token).digest('hex'),
  workspaces: [id], operations: ['index', 'query', 'read'],
  monthly_limits: { index: 1, query: 1, global_query: 0 }, expires_at: '2099-01-01T00:00:00Z',
}));
const logger = createLogger('error');
const config = loadConfig({ DATABASE_URL: 'postgresql://localhost/unused' });

const fixture = (
  hosted = true,
  options: { mcpTools?: McpToolOptions } = {},
) => {
  const usage = new Map<string, number>();
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
    listJobs: async () => [], listJobLogs: async () => [], listRetrievalLogs: async () => [],
    getJob: async () => null, enqueue: async () => ({ id: 'a-job', queuePosition: 1 }),
    acquireActiveVersionLease: async () => null, appendActivityLog: async () => undefined,
  };
  const sessions = new Map<string, McpSession>();
  const handler = createHttpHandler(store, { ...config, MCP_PUBLIC_TIER: true }, logger, sessions, undefined,
    hosted ? parseAccessPolicy({ accounts }) : undefined, undefined, undefined, options.mcpTools);
  const request = (path: string, token?: string, init: RequestInit = {}) => handler(new Request(`http://localhost${path}`, {
    ...init, headers: { host: 'localhost', ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers },
  }));
  return {
    request,
    handler,
    close: async () => { await Promise.all([...sessions.values()].map((session) => session.server.close())); await store.close(); },
  };
};

type Fixture = ReturnType<typeof fixture>;
const rpcAnonymous = (app: Fixture, method: string, params: unknown, session?: string) =>
  app.request('/mcp', undefined, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', accept: 'application/json, text/event-stream',
      ...(session ? { 'mcp-session-id': session } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });

const responseRpc = async (response: Response) => {
  const text = await response.text();
  const data = text.split('\n').find((line) => line.startsWith('data: '))?.slice(6);
  return JSON.parse(data ?? text) as { result?: { tools?: { name: string }[]; content?: { text: string }[] } };
};

describe('anonymous public-tier judgment projections', () => {
  test('serves exactly the three integrity tools to anonymous sessions', async () => {
    const judge = {
      paperStatus: async () => ({}), retractionPropagation: async () => ({}), evidenceAudit: async () => ({}),
    } as unknown as Judge;
    const app = fixture(true, { mcpTools: { integrity: { store: {} as never, judge } } });
    try {
      const init = await rpcAnonymous(app, 'initialize', {
        protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'public-test', version: '1' },
      });
      expect(init.status).toBe(200);
      expect(init.headers.get('www-authenticate')).toBeNull();
      expect(init.headers.get('x-ashesborn-tier')).toBe('public');
      const session = init.headers.get('mcp-session-id');
      expect(session).toBeTruthy();
      const list = await rpcAnonymous(app, 'tools/list', {}, session ?? undefined);
      expect((await responseRpc(list)).result?.tools?.map((tool) => tool.name).sort()).toEqual([
        'integrity_evidence_audit', 'integrity_paper_status', 'retraction_propagation',
      ]);
      const unknown = await rpcAnonymous(app, 'tools/call', { name: 'remember_text', arguments: { text: 'nope' } }, session ?? undefined);
      expect(JSON.stringify(await responseRpc(unknown))).toMatch(/unknown|not found/i);
    } finally { await app.close(); }
  });

  test('returns 404 for anonymous dashboard routes when public tier access is enabled', async () => {
    const app = fixture();
    try {
      expect((await app.request('/api/workspaces')).status).toBe(404);
      expect((await app.request('/api/workspaces/default/graph')).status).toBe(404);
    } finally { await app.close(); }
  });

  test('requires an access policy before public MCP access is granted', async () => {
    const app = fixture(false);
    try {
      const response = await app.handler(new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          host: 'mcp.example.com', 'content-type': 'application/json', accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'initialize',
          params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'anonymous', version: '1' } },
        }),
      }));
      expect(response.status).toBe(403);
      expect(response.headers.get('mcp-session-id')).toBeNull();
    } finally { await app.close(); }
  });

  test('omits evidence paths from public evidence audits while preserving the audit summary', async () => {
    const auditPayload = {
      verdict: 'SUPPORTED', confidence: 0.9, coverage: 0.8, conflict_flags: ['source_conflict'],
      tier_distribution: { A: 1, B: 2, C: 0, D: 0 }, evidence_path: [{ from: 'p1', to: 'p2' }], explain: 'summary',
    };
    const judge = {
      paperStatus: async () => ({}), retractionPropagation: async () => ({}), evidenceAudit: async () => auditPayload,
    } as unknown as Judge;
    const app = fixture(true, { mcpTools: { integrity: { store: {} as never, judge } } });
    try {
      const initialized = await rpcAnonymous(app, 'initialize', {
        protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'public-audit-two', version: '1' },
      });
      const sessionId = initialized.headers.get('mcp-session-id');
      expect(initialized.status).toBe(200);
      const response = await rpcAnonymous(app, 'tools/call', {
        name: 'integrity_evidence_audit', arguments: { doi: '10.1234/public' },
      }, sessionId ?? undefined);
      const result = await responseRpc(response);
      const output = JSON.parse(result.result?.content?.[0]?.text ?? '{}');
      expect(output).toEqual({
        verdict: 'SUPPORTED', confidence: 0.9, coverage: 0.8, conflict_flags: ['source_conflict'],
        tier_distribution: { A: 1, B: 2, C: 0, D: 0 }, evidence_path_omitted: true,
        evidence_path_count: 1, explain: 'summary',
        upgrade: { route: 'POST /api/v1/judge', dataset: 'retraction-evidence-audit', price_usd: '0.10' },
      });
      expect(output).not.toHaveProperty('evidence_path');
    } finally { await app.close(); }
  });

  test('omits the retraction root list from public propagation judgments while keeping the verdict', async () => {
    const propagationPayload = {
      verdict: 'CONTESTED', confidence: 0.96, confidence_basis: 'retraction_evidence',
      retracted_roots: [{ paper_id: 'p1' }, { paper_id: 'p2' }], conflict_flags: [],
      coverage: { ratio: 0.92 }, abstention_reason: null,
    };
    const judge = {
      paperStatus: async () => ({}), retractionPropagation: async () => propagationPayload, evidenceAudit: async () => ({}),
    } as unknown as Judge;
    const app = fixture(true, { mcpTools: { integrity: { store: {} as never, judge } } });
    try {
      const initialized = await rpcAnonymous(app, 'initialize', {
        protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'public-propagation', version: '1' },
      });
      const sessionId = initialized.headers.get('mcp-session-id');
      expect(initialized.status).toBe(200);
      const response = await rpcAnonymous(app, 'tools/call', {
        name: 'retraction_propagation', arguments: { doi: '10.1234/public' },
      }, sessionId ?? undefined);
      const result = await responseRpc(response);
      const output = JSON.parse(result.result?.content?.[0]?.text ?? '{}');
      expect(output).toMatchObject({
        verdict: 'CONTESTED', confidence: 0.96, confidence_basis: 'retraction_evidence', conflict_flags: [],
        coverage: { ratio: 0.92 }, abstention_reason: null,
        retracted_roots_omitted: true, retracted_roots_count: 2,
        upgrade: { route: 'POST /api/v1/judge', dataset: 'retraction-propagation', price_usd: '0.02' },
      });
      expect(output).not.toHaveProperty('retracted_roots');
    } finally { await app.close(); }
  });
});
