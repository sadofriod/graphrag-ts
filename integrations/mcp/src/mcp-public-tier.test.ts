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

const sseData = (text: string) => text.split('\n').find((line) => line.startsWith('data: '))?.slice(6);
const parseJsonBody = (text: string) => JSON.parse(sseData(text) ?? text) as {
  result?: { tools?: { name: string; description?: string }[]; content?: { text: string }[]; isError?: boolean };
};
const responseRpc = async (response: Response) => parseJsonBody(await response.text());

const expectPublicIntegrityTools = async (app: Fixture, session?: string) => {
  const list = await rpcAnonymous(app, 'tools/list', {}, session);
  const tools = (await responseRpc(list)).result?.tools ?? [];
  expect(tools.map((tool) => tool.name).sort()).toEqual([
    'integrity_evidence_audit', 'integrity_paper_status', 'retraction_propagation',
  ]);
  expect(tools.find((tool) => tool.name === 'retraction_propagation')?.description).toContain('$0.02');
  expect(tools.find((tool) => tool.name === 'integrity_evidence_audit')?.description).toContain('$0.10');
};

const expectPaidToolsGated = async (app: Fixture, session?: string) => {
  for (const [name, product, usd, atomic] of [
    ['retraction_propagation', 'retraction-propagation', '$0.02', '20000'],
    ['integrity_evidence_audit', 'retraction-evidence-audit', '$0.10', '100000'],
  ] as const) {
    const response = await rpcAnonymous(app, 'tools/call', {
      name, arguments: { doi: '10.1234/anonymous' },
    }, session);
    const result = (await responseRpc(response)).result;
    const refusal = JSON.parse(result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
    expect(result?.isError).toBe(true);
    expect(refusal).toEqual({
      error: 'payment_required', product, price: { usd, atomic }, scheme: 'x402', network: 'base',
      pay_endpoint: config.MCP_PAYWALL_PAY_ENDPOINT, docs: config.MCP_PAYWALL_DOCS_URL,
    });
    for (const key of ['verdict', 'confidence', 'coverage', 'retracted_roots']) expect(refusal).not.toHaveProperty(key);
  }
};

describe('anonymous public-tier judgment paywall', () => {
  test('lists all integrity tools, gates paid judgments before invoking Judge, and keeps paper status free', async () => {
    let paidCalls = 0;
    const judge = {
      paperStatus: async () => ({ paper: { paper_id: 'p1' }, statuses: ['retracted'] }),
      retractionPropagation: async () => { paidCalls++; return { verdict: 'SUPPORTED' }; },
      evidenceAudit: async () => { paidCalls++; return { verdict: 'SUPPORTED' }; },
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
      await expectPublicIntegrityTools(app, session ?? undefined);
      await expectPaidToolsGated(app, session ?? undefined);
      const free = await rpcAnonymous(app, 'tools/call', {
        name: 'integrity_paper_status', arguments: { doi: '10.1234/anonymous' },
      }, session ?? undefined);
      expect(JSON.parse((await responseRpc(free)).result?.content?.[0]?.text ?? '{}')).toMatchObject({
        paper: { paper_id: 'p1' }, statuses: ['retracted'],
      });
      expect(paidCalls).toBe(0);
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

  test('refuses public evidence audits without invoking the judge', async () => {
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
      expect(result.result?.isError).toBe(true);
      expect(output).toEqual({
        error: 'payment_required', product: 'retraction-evidence-audit', price: { usd: '$0.10', atomic: '100000' },
        scheme: 'x402', network: 'base', pay_endpoint: config.MCP_PAYWALL_PAY_ENDPOINT, docs: config.MCP_PAYWALL_DOCS_URL,
      });
      for (const key of ['verdict', 'confidence', 'coverage', 'tier_distribution', 'evidence_path', 'explain']) {
        expect(output).not.toHaveProperty(key);
      }
    } finally { await app.close(); }
  });

  test('refuses public propagation judgments without invoking the judge', async () => {
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
      expect(result.result?.isError).toBe(true);
      expect(output).toEqual({
        error: 'payment_required', product: 'retraction-propagation', price: { usd: '$0.02', atomic: '20000' },
        scheme: 'x402', network: 'base', pay_endpoint: config.MCP_PAYWALL_PAY_ENDPOINT, docs: config.MCP_PAYWALL_DOCS_URL,
      });
      for (const key of ['verdict', 'confidence', 'coverage', 'retracted_roots', 'explain']) expect(output).not.toHaveProperty(key);
    } finally { await app.close(); }
  });

  test('keyed MCP sessions receive the full paid judgment payload', async () => {
    const judgment = { verdict: 'CONTESTED', confidence: 0.96, retracted_roots: [{ paper_id: 'p1' }] };
    const judge = {
      paperStatus: async () => ({}), retractionPropagation: async () => judgment, evidenceAudit: async () => ({}),
    } as unknown as Judge;
    const app = fixture(true, { mcpTools: { integrity: { store: {} as never, judge } } });
    try {
      const init = await app.request('/mcp', tokens.alpha, {
        method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
          protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'keyed-test', version: '1' },
        } }),
      });
      const session = init.headers.get('mcp-session-id');
      expect(init.status).toBe(200);
      const response = await app.request('/mcp', tokens.alpha, {
        method: 'POST', headers: {
          'content-type': 'application/json', accept: 'application/json, text/event-stream',
          ...(session ? { 'mcp-session-id': session } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: {
          name: 'retraction_propagation', arguments: { doi: '10.1234/keyed' },
        } }),
      });
      const output = JSON.parse((await responseRpc(response)).result?.content?.[0]?.text ?? '{}');
      expect(output).toEqual(judgment);
    } finally { await app.close(); }
  });
});
