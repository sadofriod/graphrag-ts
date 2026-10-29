import { decodePaymentHeader, type PaymentRequirements } from './types.ts';
import { describe, expect, judgmentDataset, settings, setup, test } from './testSupport.ts';

const judgmentBody = { dataset_id: judgmentDataset.id, doi: '10.1234/example' };
const signed = (app: ReturnType<typeof setup>, nonce: string): string => app.sign('local', nonce, {
  amount: '20000', extra: { name: 'USDC', version: '2' },
});

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
    expect(required.accepts[0]).toMatchObject({ scheme: 'exact', amount: '20000' });
    expect(required.resource.url).toBe(`${settings.publicBaseUrl?.replace(/\/$/, '')}/api/v1/judge`);
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
