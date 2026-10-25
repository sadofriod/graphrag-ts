import { decodePaymentHeader, type PaymentRequirements } from './types.ts';
import { describe, expect, setup, test } from './testSupport.ts';

describe('x402 paid query settlement', () => {
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
    const [payment] = app.records.values();
    expect(payment?.answerBody).not.toHaveProperty('payment.transaction', '0xtx');
    expect(payment?.responseBody).toHaveProperty('payment.transaction', '0xtx');
    expect(payment?.payer).toBe('0xbuyer');
    expect(app.settledAmounts).toEqual(['20000']);
  });

  test('returns the settled answer when the post-settlement ledger write fails', async () => {
    const app = setup({ completePaymentFails: true });
    const response = await app.request();
    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({ answer: 'local answer' });
    expect(decodePaymentHeader(response?.headers.get('payment-response') ?? '')).toMatchObject({ success: true, transaction: '0xtx' });
  });

  test('settles global upto according to returned map answer usage without exceeding authorization', async () => {
    const app = setup({ result: 'global' });
    const response = await app.request({ dataset_id: 'demo', query: 'test', mode: 'global' }, app.sign('global'));
    expect(response?.status).toBe(200);
    expect(app.settledAmounts).toEqual(['40000']);
    expect(BigInt(app.settledAmounts[0] ?? '0')).toBeLessThanOrEqual(100000n);
    expect(await response?.json()).toMatchObject({
      usage: { map_answers: 2 },
      sources: [{ source: 'map-answer:c1', excerpt: 'map a' }, { source: 'map-answer:c2', excerpt: 'map b' }],
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

  test('settlement transport failure preserves answer and replays as unknown', async () => {
    const app = setup({ settlementThrows: true });
    const signature = app.sign('local', 'nonce-settlement-unknown');
    const first = await app.request(undefined, signature);
    expect(first?.status).toBe(409);
    expect(await first?.json()).toMatchObject({ status: 'settlement_unknown', recovery: 'retry with the same PAYMENT-SIGNATURE' });
    const [record] = app.records.values();
    expect(record).toMatchObject({ status: 'settlement_unknown', settleAttempts: 1, answerBody: { answer: 'local answer' } });
    const replay = await app.request(undefined, signature);
    expect(replay?.status).toBe(409);
    expect(await replay?.json()).toMatchObject({ status: 'settlement_unknown' });
    expect(app.executions).toBe(1);
    expect(app.settleCalls).toBe(1);
  });

  test('does not settle if reconciliation already claimed the authorized payment', async () => {
    const app = setup({ settlementClaimFails: true });
    const signature = app.sign('local', 'nonce-claim-lost');
    const first = await app.request(undefined, signature);
    expect(first?.status).toBe(409);
    expect(await first?.json()).toMatchObject({ status: 'payment_not_claimed' });
    expect(app.settleCalls).toBe(0);
    expect([...app.records.values()][0]).toMatchObject({ status: 'failed' });
    expect((await app.request(undefined, signature))?.status).toBe(402);
  });

  test('concurrent identical signed requests settle only once', async () => {
    const app = setup();
    const signature = app.sign('local', 'nonce-concurrent');
    const [first, second] = await Promise.all([app.request(undefined, signature), app.request(undefined, signature)]);
    expect([first?.status, second?.status].sort()).toEqual([200, 409]);
    expect(app.settleCalls).toBe(1);
  });
});
