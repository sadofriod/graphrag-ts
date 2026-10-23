import { describe, expect, test } from 'bun:test';
import { loadConfig } from '../config.ts';
import { createLogger } from '../log.ts';
import type { IndexStore } from '../store.ts';
import { QueryServiceError, type runSnapshotQuery } from '../queryService.ts';
import type { DatasetRegistry } from './datasets.ts';
import { createPaidQueryRoute } from './gateway.ts';
import type { FacilitatorClient } from './facilitator.ts';
import { PaymentConflictError, PaymentReplayError, type PaymentRecord, type PaymentStore } from './payments.ts';
import { decodePaymentHeader, encodePaymentHeader, type PaymentPayload, type PaymentRequirements } from './types.ts';
import type { X402Settings } from './settings.ts';

const config = loadConfig({ DATABASE_URL: 'postgresql://localhost/unused', QUERY_TIMEOUT_MS: '1000' });
const logger = createLogger('error');
const settings: X402Settings = {
  facilitatorUrl: 'https://facilitator.invalid', network: 'eip155:84532', asset: '0xasset', assetName: 'USDC',
  assetVersion: '2', payTo: '0xreceiver', maxTimeoutSeconds: 60, publicBaseUrl: 'https://api.example.test/',
};
const registry: DatasetRegistry = { datasets: [{
  id: 'demo', workspaceId: 'workspace-demo', title: 'Demo dataset', description: 'Synthetic demo.', synthetic: true,
  license: { spdx: 'MIT', url: 'https://example.test/license' }, tags: ['demo'],
  pricing: {
    local: { usd: '$0.02', atomic: '20000' },
     global: { scheme: 'upto', upto: { usd: '$0.10', atomic: '100000' }, base: { usd: '$0.02', atomic: '20000' }, perMapAnswer: { usd: '$0.01', atomic: '10000' } },
  },
}] };

const recordBase = (input: Parameters<PaymentStore['beginPayment']>[0]): PaymentRecord => ({
  id: input.id, requestId: input.requestId, requestHash: input.requestHash, nonce: input.nonce, datasetId: input.datasetId,
  mode: input.mode, scheme: input.scheme, network: input.network, asset: input.asset, amountAuthorized: input.amountAuthorized,
  amountSettled: null, payer: null, status: 'pending', transaction: null, errorReason: null, responseBody: null,
  datasetVersion: null, latencyMs: null, createdAt: new Date(0), updatedAt: new Date(0), settledAt: null,
});

const setup = (options: {
  readonly valid?: boolean;
  readonly result?: 'local' | 'global' | 'failure' | 'timeout';
  readonly capacity?: boolean;
  readonly completePaymentFails?: boolean;
  readonly globalScheme?: 'upto' | 'exact';
} = {}) => {
  const testRegistry: DatasetRegistry = options.globalScheme
    ? { datasets: registry.datasets.map((dataset) => ({ ...dataset, pricing: { ...dataset.pricing, global: { ...dataset.pricing.global, scheme: options.globalScheme! } } })) }
    : registry;
  const records = new Map<string, PaymentRecord>();
  const nonceRequests = new Map<string, string>();
  let verifyCalls = 0;
  let settleCalls = 0;
  const settledAmounts: string[] = [];
  let executions = 0;
  let failNextSettlement = false;
  const payments = {
    beginPayment: async (input: Parameters<PaymentStore['beginPayment']>[0]) => {
      const existing = records.get(input.requestId);
      if (existing) {
        if (existing.requestHash !== input.requestHash) throw new PaymentConflictError();
        return { kind: 'replay' as const, record: existing };
      }
      const seen = nonceRequests.get(input.nonce);
      if (seen) throw new PaymentReplayError();
      const record = recordBase(input);
      records.set(input.requestId, record);
      nonceRequests.set(input.nonce, input.requestId);
      return { kind: 'new' as const, record };
    },
    completePayment: async (id: string, input: Parameters<PaymentStore['completePayment']>[1]) => {
      if (options.completePaymentFails) throw new Error('ledger unavailable');
      const found = [...records.values()].find((item) => item.id === id);
      if (!found) throw new Error('missing');
      const completed = { ...found, status: 'settled' as const, amountSettled: input.amountSettled, payer: input.payer,
        transaction: input.transaction, responseBody: input.responseBody, datasetVersion: input.datasetVersion,
        latencyMs: input.latencyMs, settledAt: new Date(0) };
      records.set(found.requestId, completed);
      return completed;
    },
    failPayment: async (id: string, input: { errorReason: string; payer?: string }) => {
      const found = [...records.values()].find((item) => item.id === id);
      if (found) records.set(found.requestId, { ...found, status: 'failed', errorReason: input.errorReason });
    },
    getPaymentById: async () => undefined,
    metrics: async () => ({ settledCount: 0, failedCount: 0, pendingCount: 0, settledAmount: '0' }),
  } as PaymentStore;
  const facilitator: FacilitatorClient = {
    verify: async () => { verifyCalls++; return options.valid === false ? { isValid: false, invalidReason: 'invalid payment', payer: '0xbuyer' } : { isValid: true, payer: '0xbuyer' }; },
    settle: async ({ paymentRequirements }) => {
      settleCalls++;
      settledAmounts.push(paymentRequirements.amount);
      if (failNextSettlement) return { success: false, transaction: '', network: settings.network, errorReason: 'settlement rejected' };
      return { success: true, transaction: '0xtx', network: settings.network, payer: '0xbuyer' };
    },
  };
  const leasedStore = {
    acquireActiveVersionLease: async () => ({ id: 'version-1', workspaceId: 'workspace-demo', namespace: 'snapshot', leaseId: 'lease-1' }),
    renewQueryLease: async () => undefined,
    releaseQueryLease: async () => undefined,
    appendActivityLog: async () => undefined,
  } as unknown as IndexStore;
  let releaseSlot: (() => void) | undefined;
  const limiter = options.capacity
    ? { tryAcquire: () => undefined }
    : { tryAcquire: () => { releaseSlot = () => undefined; return releaseSlot; } };
  const runQuery = (async () => {
    executions++;
    if (options.result === 'failure') throw new Error('private retrieval message');
    if (options.result === 'timeout') throw new QueryServiceError('QUERY_TIMEOUT', 'timeout');
    const result = options.result === 'global'
      ? { answer: 'global answer', selectedMapAnswers: [
          { answer: 'map a', communityIds: ['c1'], usefulness: 0.8 }, { answer: 'map b', communityIds: ['c2'], usefulness: 0.7 },
        ] }
      : { answer: 'local answer', evidence: [{ text: 'evidence', sourceDocumentId: 'source.md' }] };
    return { result, version: { id: 'version-1', workspaceId: 'workspace-demo' }, durationMs: 12, leaseId: 'lease-1' };
  }) as unknown as typeof runSnapshotQuery;
  const route = createPaidQueryRoute({
    store: leasedStore, config, logger, registry: testRegistry, payments, facilitator, limiter, settings, now: () => 1_700_000_000_000, runQuery,
  });
  const sign = (mode: 'local' | 'global' = 'local', nonce = 'nonce-0001', overrides: Partial<PaymentRequirements> = {}) => {
    const accepted: PaymentRequirements = {
      scheme: mode === 'local' ? 'exact' : testRegistry.datasets[0]?.pricing.global.scheme ?? 'upto', network: settings.network,
      amount: mode === 'local' ? '20000' : '100000', asset: settings.asset, payTo: settings.payTo,
      maxTimeoutSeconds: 60, extra: { name: 'USDC', version: '2' }, ...overrides,
    };
    if (mode === 'global' && accepted.scheme === 'upto') accepted.extra = { name: 'USDC', version: '2', paymentFlow: 'authorization' };
    const payload: PaymentPayload = { x402Version: 2, accepted, payload: { authorization: { nonce } } };
    return encodePaymentHeader(payload);
  };
  const request = (body: unknown = { dataset_id: 'demo', query: 'test' }, signature = sign(), extraHeaders: Record<string, string> = {}) => route(new Request('https://internal.test/api/v1/query', {
    method: 'POST', headers: { host: 'internal.test', 'content-type': 'application/json', 'PAYMENT-SIGNATURE': signature, ...extraHeaders }, body: JSON.stringify(body),
  }));
  return {
    route, request, sign, records, get verifyCalls() { return verifyCalls; }, get settleCalls() { return settleCalls; },
    get settledAmounts() { return settledAmounts; }, get executions() { return executions; },
    get releaseSlot() { return releaseSlot; }, get failNextSettlement() { return failNextSettlement; },
    set failNextSettlement(value: boolean) { failNextSettlement = value; },
  };
};

describe('x402 paid query gateway', () => {
  test('returns a v2 payment challenge and free catalogue with CORS', async () => {
    const app = setup();
    const challenge = await app.route(new Request('https://internal.test/api/v1/query', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dataset_id: 'demo', query: 'test' }),
    }));
    expect(challenge?.status).toBe(402);
    expect(challenge?.headers.get('access-control-expose-headers')).toContain('PAYMENT-REQUIRED');
    const required = decodePaymentHeader(challenge?.headers.get('payment-required') ?? '') as {
      accepts: PaymentRequirements[]; extensions: { bazaar: unknown };
      resource: { url: string; serviceName?: string; tags?: string[] };
    };
    expect(required.accepts[0]).toMatchObject({ scheme: 'exact', amount: '20000' });
    const bazaar = required.extensions.bazaar as { info: { input: { type: string; method: string; bodyType: string; body: { dataset_id: string } }; output: { type: string } }; schema: { $ref?: string; required: string[] } };
    expect(bazaar.info.input).toMatchObject({ type: 'http', method: 'POST', bodyType: 'json', body: { dataset_id: 'demo' } });
    expect(bazaar.info.output.type).toBe('json');
    expect(bazaar.schema.$ref).toBeUndefined();
    expect(bazaar.schema.required).toContain('input');
    expect(required.resource.url).toBe('https://api.example.test/api/v1/query');
    expect(required.resource).toMatchObject({ serviceName: 'graphrag-ts' });
    expect(required.resource.tags).toHaveLength(1);
    for (const path of ['/api/v1/datasets', '/api/v1/pricing']) {
      const response = await app.route(new Request(`https://internal.test${path}`));
      expect(response?.status).toBe(200);
      expect((await response?.json()) as { datasets: unknown[] }).toHaveProperty('datasets');
    }
  });

  test('serves cached resource-server and dataset discovery without payment', async () => {
    const app = setup();
    const manifest = await app.route(new Request('https://internal.test/.well-known/x402'));
    expect(manifest?.status).toBe(200);
    expect(manifest?.headers.get('cache-control')).toBe('public, max-age=300');
    expect(manifest?.headers.get('content-type')).toContain('application/json');
    expect(manifest?.headers.get('access-control-allow-origin')).toBe('*');
    expect(await manifest?.json()).toMatchObject({
      kind: 'resource-server', resources: [{ url: 'https://api.example.test/api/v1/query' }],
    });
    const discovery = await app.route(new Request('https://internal.test/api/v1/discovery'));
    expect(discovery?.status).toBe(200);
    expect(await discovery?.json()).toMatchObject({
      x402Version: 2,
      items: [{ resource: 'https://api.example.test/api/v1/query', accepts: [{ scheme: 'exact', amount: '20000' }] }],
      pagination: { limit: 20, offset: 0, total: 1 },
    });
  });

  test('serves the x402 exchange over real HTTP headers', async () => {
    const app = setup();
    const server = Bun.serve({
      port: 0,
      fetch: async (request: Request) => (await app.route(request)) ?? new Response('not found', { status: 404 }),
    });
    try {
      const url = `http://127.0.0.1:${server.port}/api/v1/query`;
      const challenge = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dataset_id: 'demo', query: 'test' }),
      });
      expect(challenge.status).toBe(402);
      const required = decodePaymentHeader(challenge.headers.get('payment-required') ?? '') as {
        x402Version: number; accepts: PaymentRequirements[]; extensions: { bazaar: unknown };
      };
      expect(required).toMatchObject({
        x402Version: 2,
        accepts: [{ scheme: 'exact', amount: '20000' }],
        extensions: { bazaar: expect.anything() },
      });
      const exposedHeaders = challenge.headers.get('access-control-expose-headers') ?? '';
      expect(exposedHeaders).toContain('PAYMENT-REQUIRED');
      expect(exposedHeaders).toContain('PAYMENT-RESPONSE');

      const paid = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': app.sign() },
        body: JSON.stringify({ dataset_id: 'demo', query: 'test' }),
      });
      expect(paid.status).toBe(200);
      expect(decodePaymentHeader(paid.headers.get('payment-response') ?? '')).toMatchObject({
        success: true, transaction: '0xtx', amount: '20000',
      });
    } finally {
      server.stop(true);
    }
  });

  test('rejects invalid bodies, unknown datasets, malformed signatures and mismatched requirements', async () => {
    const app = setup();
    expect((await app.request({ dataset_id: 'demo', query: '', unexpected: true }))?.status).toBe(400);
    expect((await app.request({ dataset_id: 'unknown', query: 'test' }))?.status).toBe(404);
    expect((await app.request({ dataset_id: 'demo', query: 'test' }, 'invalid-base64'))?.status).toBe(400);
    expect((await app.request(undefined, app.sign('local', 'nonce-0001', { amount: '1' })))?.status).toBe(402);
  });

  test('does not execute or settle when facilitator verification fails', async () => {
    const app = setup({ valid: false });
    const response = await app.request();
    expect(response?.status).toBe(402);
    expect(app.executions).toBe(0);
    expect(app.settleCalls).toBe(0);
    expect(await response?.json()).toEqual({ error: 'invalid payment' });
    expect(response?.headers.get('payment-required')).toBeTruthy();
  });

  test('settles local queries and reports sources, version, usage and receipt', async () => {
    const app = setup();
    const response = await app.request();
    expect(response?.status).toBe(200);
    expect(response?.headers.get('payment-response')).toBeTruthy();
    expect(await response?.json()).toMatchObject({
      answer: 'local answer', mode: 'local', dataset: { id: 'demo', version: 'version-1', workspace_id: 'workspace-demo' },
      sources: [{ source: 'source.md', excerpt: 'evidence' }], usage: { query_ms: 12, map_answers: 0 },
      payment: { amount: '20000', transaction: '0xtx' },
    });
    expect(app.settledAmounts).toEqual(['20000']);
  });

  test('returns the settled answer when the post-settlement ledger write fails', async () => {
    const app = setup({ completePaymentFails: true });
    const response = await app.request();

    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({ answer: 'local answer' });
    expect(decodePaymentHeader(response?.headers.get('payment-response') ?? '')).toMatchObject({
      success: true, transaction: '0xtx',
    });
  });

  test('settles global upto according to returned map answer usage without exceeding authorization', async () => {
    const app = setup({ result: 'global' });
    const response = await app.request({ dataset_id: 'demo', query: 'test', mode: 'global' }, app.sign('global'));
    expect(response?.status).toBe(200);
    expect(app.settledAmounts).toEqual(['40000']);
    expect(BigInt(app.settledAmounts[0] ?? '0')).toBeLessThanOrEqual(100000n);
    expect(await response?.json()).toMatchObject({
      usage: { map_answers: 2 },
      sources: [
        { source: 'map-answer:c1', excerpt: 'map a' },
        { source: 'map-answer:c2', excerpt: 'map b' },
      ],
    });
  });

  test('advertises and settles global exact at the flat upto amount', async () => {
    const app = setup({ result: 'global', globalScheme: 'exact' });
    const challenge = await app.route(new Request('https://internal.test/api/v1/query', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dataset_id: 'demo', query: 'test', mode: 'global' }),
    }));
    const required = decodePaymentHeader(challenge?.headers.get('payment-required') ?? '') as { accepts: PaymentRequirements[] };
    expect(required.accepts[0]).toMatchObject({ scheme: 'exact', amount: '100000' });
    const response = await app.request({ dataset_id: 'demo', query: 'test', mode: 'global' }, app.sign('global', 'nonce-exact-1'));
    expect(response?.status).toBe(200);
    expect(app.settledAmounts).toEqual(['100000']);
  });

  test('retrieval failures and timeout never settle or expose library errors', async () => {
    for (const [result, expected] of [['failure', 502], ['timeout', 504]] as const) {
      const app = setup({ result });
      const response = await app.request();
      expect(response?.status).toBe(expected);
      expect(app.settleCalls).toBe(0);
      expect(await response?.text()).not.toContain('private retrieval message');
    }
  });

  test('replays a settled request without charging again and rejects nonce reuse', async () => {
    const app = setup();
    const headers = { 'Idempotency-Key': 'stable-key-001' };
    const signature = app.sign('local', 'nonce-replay-1');
    const first = await app.request(undefined, signature, headers);
    const firstBody = await first?.text();
    const replay = await app.request(undefined, signature, headers);
    expect(replay?.status).toBe(200);
    expect(await replay?.text()).toBe(firstBody);
    expect(app.settleCalls).toBe(1);
    expect(app.executions).toBe(1);
    expect((await app.request({ dataset_id: 'demo', query: 'different' }, signature, { 'Idempotency-Key': 'different-key-01' }))?.status).toBe(409);
  });

  test('marks capacity exhaustion failed and answers 503', async () => {
    const app = setup({ capacity: true });
    const response = await app.request();
    expect(response?.status).toBe(503);
    expect(app.verifyCalls).toBe(0);
    expect([...app.records.values()][0]?.errorReason).toBe('capacity');
  });
});
