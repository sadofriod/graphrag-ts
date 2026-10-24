import { createHash } from 'node:crypto';
import { requestHash } from './payload.ts';
import { decodePaymentHeader, type PaymentPayload, type PaymentRequirements } from './types.ts';
import { describe, expect, settings, setup, test } from './testSupport.ts';

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
    expect(required.accepts[0]?.extra).not.toHaveProperty('facilitatorAddress');
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

  test('includes the facilitator address in global upto requirements', async () => {
    const app = setup();
    const challenge = await app.route(new Request('https://internal.test/api/v1/query', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dataset_id: 'demo', query: 'test', mode: 'global' }),
    }));
    const required = decodePaymentHeader(challenge?.headers.get('payment-required') ?? '') as { accepts: PaymentRequirements[] };
    expect(required.accepts[0]?.extra).toMatchObject({
      paymentFlow: 'authorization', facilitatorAddress: settings.uptoFacilitatorAddress,
    });
  });

  test('serves cached resource-server and dataset discovery without payment', async () => {
    const app = setup();
    const manifest = await app.route(new Request('https://internal.test/.well-known/x402'));
    expect(manifest?.status).toBe(200);
    expect(manifest?.headers.get('cache-control')).toBe('public, max-age=300');
    expect(manifest?.headers.get('content-type')).toContain('application/json');
    expect(manifest?.headers.get('access-control-allow-origin')).toBe('*');
    expect(await manifest?.json()).toMatchObject({ kind: 'resource-server', resources: [{ url: 'https://api.example.test/api/v1/query' }] });
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
      expect(required).toMatchObject({ x402Version: 2, accepts: [{ scheme: 'exact', amount: '20000' }], extensions: { bazaar: expect.anything() } });
      const exposedHeaders = challenge.headers.get('access-control-expose-headers') ?? '';
      expect(exposedHeaders).toContain('PAYMENT-REQUIRED');
      expect(exposedHeaders).toContain('PAYMENT-RESPONSE');
      const paid = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': app.sign() },
        body: JSON.stringify({ dataset_id: 'demo', query: 'test' }),
      });
      expect(paid.status).toBe(200);
      expect(decodePaymentHeader(paid.headers.get('payment-response') ?? '')).toMatchObject({ success: true, transaction: '0xtx', amount: '20000' });
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
    const signature = app.sign('local', 'nonce-invalid-1');
    const response = await app.request(undefined, signature, { 'Idempotency-Key': 'free-key-001' });
    expect(response?.status).toBe(402);
    expect(app.executions).toBe(0);
    expect(app.settleCalls).toBe(0);
    expect(app.records.size).toBe(0);
    expect(app.rejected).toHaveLength(1);
    expect(await response?.json()).toEqual({ error: 'invalid payment' });
    expect(response?.headers.get('payment-required')).toBeTruthy();
    app.valid = true;
    expect((await app.request(undefined, signature, { 'Idempotency-Key': 'free-key-001' }))?.status).toBe(200);
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

  test('replays the stored answer after the dataset quote changes', async () => {
    const app = setup();
    const signature = app.sign('local', 'nonce-price-change');
    const first = await app.request(undefined, signature);
    const body = await first?.text();
    app.changePrice();
    const replay = await app.request(undefined, signature);
    expect(replay?.status).toBe(200);
    expect(await replay?.text()).toBe(body);
    expect(app.verifyCalls).toBe(1);
    expect(app.settleCalls).toBe(1);
  });

  test('sweeping a stale authorized replay makes it failed instead of permanently in progress', async () => {
    const app = setup();
    const signature = app.sign('local', 'nonce-stale-authorized');
    const accepted = decodePaymentHeader(signature) as PaymentPayload;
    const begun = await app.payments.beginPayment({
      id: 'stale-id', requestId: 'stale-request', requestHash: requestHash({ dataset_id: 'demo', query: 'test', mode: 'local', max_results: 5 }), nonce: 'nonce-stale-authorized',
      datasetId: 'demo', workspaceId: 'workspace-demo', mode: 'local', scheme: 'exact', network: settings.network,
      asset: settings.asset, amountAuthorized: '20000', payloadFingerprint: createHash('sha256').update(signature).digest('hex'), payload: accepted,
      requirements: accepted.accepted, payer: '0xbuyer',
    });
    expect(begun.kind).toBe('new');
    if (begun.kind !== 'new') throw new Error('Expected a new stale payment record.');
    const outcome = await app.payments.resolveStale(begun.record.id);
    const [afterSweep] = app.records.values();
    expect(outcome).toBe('abandoned');
    expect(afterSweep).toMatchObject({ status: 'failed', errorReason: 'abandoned_before_settlement' });
    expect((await app.request(undefined, signature))?.status).toBe(402);
  });

  test('same body with a different signature cannot retrieve another buyer answer', async () => {
    const app = setup();
    const buyer = await app.request(undefined, app.sign('local', 'nonce-buyer-one'));
    expect(buyer?.status).toBe(200);
    app.valid = false;
    const collision = await app.request(undefined, app.sign('local', 'nonce-buyer-two'));
    expect(collision?.status).toBe(402);
    expect(await collision?.text()).not.toContain('local answer');
  });

  test('answers 503 on capacity exhaustion without verifying or reserving anything', async () => {
    const app = setup({ capacity: true });
    const response = await app.request();
    expect(response?.status).toBe(503);
    // A saturated server must not call the facilitator, and must not claim the idempotency key or nonce of a request it refuses.
    expect(app.verifyCalls).toBe(0);
    expect(app.settleCalls).toBe(0);
    expect(app.records.size).toBe(0);
  });
});
