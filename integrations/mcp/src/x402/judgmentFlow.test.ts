import { decodePaymentHeader, type PaymentRequirements } from './types.ts';
import { describe, expect, judgmentDataset, settings, setup, test } from './testSupport.ts';

const judgmentBody = { dataset_id: judgmentDataset.id, doi: '10.1234/example' };
const signed = (app: ReturnType<typeof setup>, nonce: string, network = settings.network): string => app.sign('local', nonce,
  network !== settings.network
    ? { network, asset: settings.asset, amount: '20000', extra: { name: settings.assetName, version: settings.assetVersion } }
    : { amount: '20000', extra: { name: 'USDC', version: '2' } });

const postJudge = (app: ReturnType<typeof setup>, body: unknown, signature?: string) => app.route(new Request('https://internal.test/api/v1/judge', {
  method: 'POST', headers: { 'content-type': 'application/json', ...(signature ? { 'PAYMENT-SIGNATURE': signature } : {}) },
  body: JSON.stringify(body),
}));

describe('paid integrity judgment route', () => {
  test('challenges for exact per-call payment at the judge resource', async () => {
    const app = setup({ includeJudgment: true });
    const response = await postJudge(app, judgmentBody);
    expect(response?.status).toBe(402);
    const required = decodePaymentHeader(response?.headers.get('payment-required') ?? '') as {
      accepts: PaymentRequirements[]; resource: { url: string };
    };
    expect(required.accepts).toHaveLength(2);
    expect(required.accepts[0]).toMatchObject({ scheme: 'exact', amount: '20000' });
    expect(required.accepts[1]).toMatchObject({ scheme: 'exact', network: 'eip155:42161', amount: '20000' });
    expect(required.accepts).toEqual([
      {
        scheme: 'exact', network: 'eip155:84532', amount: '20000', asset: '0xasset', payTo: '0xreceiver',
        maxTimeoutSeconds: 60, extra: { name: 'USDC', version: '2' },
      },
      {
        scheme: 'exact', network: 'eip155:42161', amount: '20000', asset: '0xasset', payTo: '0xreceiver',
        maxTimeoutSeconds: 60, extra: { name: 'USDC', version: '2' },
      },
    ]);
    expect(required.resource.url).toBe(`${settings.publicBaseUrl?.replace(/\/$/, '')}/api/v1/judge`);
  });

  test('verifies and settles against the matched Arbitrum requirements', async () => {
    const app = setup({ includeJudgment: true });
    const signature = signed(app, 'judge-arbitrum-01', 'eip155:42161');
    const response = await postJudge(app, judgmentBody, signature);
    expect(response?.status).toBe(200);
    expect(app.verifiedNetworks).toEqual(['eip155:42161']);
    expect(app.settledNetworks).toEqual(['eip155:42161']);
    expect([...app.records.values()][0]?.network).toBe('eip155:42161');
  });

  test('returns 404 for unknown products and graph datasets', async () => {
    const app = setup({ includeJudgment: true });
    expect((await postJudge(app, { ...judgmentBody, dataset_id: 'missing' }))?.status).toBe(404);
    expect((await postJudge(app, { ...judgmentBody, dataset_id: 'demo' }))?.status).toBe(404);
  });

  test('settles only after judgment exists and returns the paid judgment contract', async () => {
    const app = setup({ includeJudgment: true });
    const response = await postJudge(app, judgmentBody, signed(app, 'judge-success-01'));
    expect(response?.status).toBe(200);
    const body = await response?.json() as { dataset: unknown; judgment: { verdict: string }; payment: { amount: string } };
    expect(body).toMatchObject({ dataset: { id: judgmentDataset.id, tool: 'retraction_propagation' }, judgment: { verdict: 'SUPPORTED' }, payment: { amount: '20000' } });
    expect(app.events).toEqual(['judge', 'settle']);
    expect(app.settleCalls).toBe(1);
  });

  test('runs a batch SKU after one payment and preserves per-reference judgment fields', async () => {
    const app = setup({ includeJudgment: true });
    const response = await postJudge(app, { dataset_id: 'reference-audit-10', references: ['10.1234/example'] }, app.sign('local', 'judge-batch-success-01', {
      amount: '500000', extra: { name: 'USDC', version: '2' },
    }));
    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({
      dataset: { id: 'reference-audit-10', tool: 'reference_batch' },
      judgment: { snapshot: { id: 'snapshot-1' }, items: [{ input: '10.1234/example', matched: true, verdict: 'SUPPORTED', paper_id: 'W123' }],
        summary: { requested: 1, matched: 1, unmatched: [], retracted_root_count: 0 } },
      payment: { amount: '500000' },
    });
    expect(app.events).toEqual(['judge', 'settle']);
    expect(app.settleCalls).toBe(1);
  });

  test('runs dependency_scan through one payment and persists OSV items and summary', async () => {
    const scanResult = { source: 'OSV', queried_at: '2026-01-01T00:00:00.000Z',
      items: [{ input: 'lodash@4.17.20', name: 'lodash', version: '4.17.20', ecosystem: 'npm', existence: 'confirmed', affected: false, advisories: [], note: 'No advisory recorded in OSV for this name and version. This is not a statement that the package is safe.', abstention_reason: null }],
      summary: { requested: 1, checked: 1, affected_packages: 0, advisory_count: 0, not_found_packages: 0, unchecked_packages: 0 } };
    const app = setup({ includeJudgment: true, dependencyResult: scanResult });
    const response = await app.route(new Request('https://internal.test/api/v1/deps/scan-20', {
      method: 'POST', headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': app.sign('local', 'dependency-paid-flow-01') },
      body: JSON.stringify({ packages: ['lodash@4.17.20'] }),
    }));
    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({ dataset: { tool: 'dependency_scan' }, judgment: scanResult, payment: { amount: '20000' } });
    expect(app.settleCalls).toBe(1);
  });

  test('does not settle paid dependency scans when OSV is unavailable', async () => {
    const app = setup({ includeJudgment: true, dependencyFailure: true });
    const response = await app.route(new Request('https://internal.test/api/v1/deps/scan-20', {
      method: 'POST', headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': app.sign('local', 'dependency-source-error-01') },
      body: JSON.stringify({ packages: ['lodash@4.17.20'] }),
    }));
    expect(response?.status).toBe(503);
    expect(await response?.json()).toEqual({ error: 'advisory_source_unavailable' });
    expect(app.settleCalls).toBe(0);
  });

  test('rounds fractional judge latency before returning and writing the ledger', async () => {
    const app = setup({ includeJudgment: true });
    const completePayment = app.payments.completePayment.bind(app.payments);
    let latencyMs = Number.NaN;
    app.payments.completePayment = async (id, input) => {
      latencyMs = input.latencyMs;
      return completePayment(id, input);
    };
    const originalNow = performance.now;
    let time = 0;
    performance.now = () => (time += 0.6);
    try {
      const response = await postJudge(app, judgmentBody, signed(app, 'judge-fractional-01'));
      expect(response?.status).toBe(200);
      const body = await response?.json() as { usage: { judge_ms: number } };
      expect(Number.isSafeInteger(latencyMs)).toBe(true);
      expect(body.usage.judge_ms).toBe(latencyMs);
      expect(body.usage.judge_ms).toBe(Math.round(body.usage.judge_ms));
    } finally {
      performance.now = originalNow;
    }
  });

  test('retries a failed ledger completion once and returns the settled receipt', async () => {
    const app = setup({ includeJudgment: true });
    const completePayment = app.payments.completePayment.bind(app.payments);
    let calls = 0;
    app.payments.completePayment = async (id, input) => {
      calls += 1;
      if (calls === 1) throw new Error('temporary ledger failure');
      return completePayment(id, input);
    };

    const response = await postJudge(app, judgmentBody, signed(app, 'judge-ledger-retry-01'));
    expect(response?.status).toBe(200);
    expect(response?.headers.get('payment-response')).toBeTruthy();
    expect(calls).toBe(2);
  });

  test('does not settle when judgment fails', async () => {
    const app = setup({ includeJudgment: true, judgeFailure: true });
    const response = await postJudge(app, judgmentBody, signed(app, 'judge-failure-01'));
    expect(response?.status).toBe(502);
    expect(await response?.json()).toEqual({ error: 'JUDGE_FAILED' });
    expect(app.settleCalls).toBe(0);
    expect([...app.records.values()][0]?.status).toBe('failed');
  });
});
