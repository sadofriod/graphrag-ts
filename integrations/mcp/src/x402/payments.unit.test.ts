import { describe, expect, test } from 'bun:test';
import { createPaymentStore, PaymentConflictError, PaymentReplayError } from './payments.ts';
import { createScriptedPool, paymentRow } from './paymentTestSupport.ts';
import type { PaymentPayload, PaymentRequirements } from './types.ts';

const payload: PaymentPayload = {
  x402Version: 2,
  accepted: { scheme: 'exact', network: 'eip155:84532', amount: '20000', asset: '0xasset', payTo: '0xreceiver', maxTimeoutSeconds: 60 },
  payload: { authorization: { nonce: 'nonce-1' } },
};
const requirements: PaymentRequirements = payload.accepted;
const input = {
  id: 'payment-id', requestId: 'request-1', requestHash: 'request-hash', nonce: 'nonce-1', datasetId: 'dataset-1',
  workspaceId: 'workspace-1', mode: 'local' as const, scheme: 'exact' as const, network: 'eip155:84532', asset: '0xasset',
  amountAuthorized: '20000', payloadFingerprint: 'fingerprint-1', payload, requirements, payer: '0xbuyer',
};
const completion = {
  payer: '0xbuyer', transaction: '0xtx', amountSettled: '18000', responseBody: { answer: 'delivered' }, datasetVersion: 'v1', latencyMs: 12,
};

describe('payment store SQL branches', () => {
  test('inserts new payments, replays by fingerprint, and conflicts without a matching fingerprint', async () => {
    const created = createScriptedPool();
    created.queueResult(/^\s*INSERT INTO x402_payments/, [paymentRow({ payload_json: payload, requirements_json: requirements })]);
    const fresh = await createPaymentStore(created.pool).beginPayment(input);
    // `beginPayment` returns the row Postgres produced, not the input we sent.
    expect(fresh).toMatchObject({ kind: 'new', record: { id: '00000000-0000-4000-8000-000000000001', amountAuthorized: '20000', answerBody: null } });
    expect(created.calls[0]?.params).toHaveLength(15);

    const replay = createScriptedPool();
    replay.queueResult(/^\s*INSERT INTO x402_payments/, []);
    replay.queueResult(/SELECT \* FROM x402_payments WHERE payload_fingerprint/, [paymentRow({ status: 'settled', amount_settled: 18000, answer_json: { old: true } })]);
    expect(await createPaymentStore(replay.pool).beginPayment(input)).toMatchObject({ kind: 'replay', record: {
      amountSettled: '18000', answerBody: { old: true },
    } });

    const conflict = createScriptedPool();
    conflict.queueResult(/^\s*INSERT INTO x402_payments/, []);
    conflict.queueResult(/payload_fingerprint/, []);
    await expect(createPaymentStore(conflict.pool).beginPayment(input)).rejects.toBeInstanceOf(PaymentConflictError);
  });

  test('uses the response body fallback when mapping a pre-migration answer record', async () => {
    const scripted = createScriptedPool();
    scripted.queueResult(/SELECT \* FROM x402_payments WHERE payload_fingerprint/, [paymentRow({ answer_json: null, response_body: { prior: 'answer' } })]);
    expect(await createPaymentStore(scripted.pool).getPaymentByFingerprint('fingerprint-1')).toMatchObject({ answerBody: { prior: 'answer' } });
  });

  test('maps unique nonce errors to replay, other unique errors to conflict, and preserves other errors', async () => {
    for (const [error, expected] of [
      [{ code: '23505', constraint: 'x402_payments_nonce_key' }, PaymentReplayError],
      [{ code: '23505', constraint: 'x402_payments_request_id_key' }, PaymentConflictError],
    ] as const) {
      const scripted = createScriptedPool();
      scripted.queueError(/^\s*INSERT INTO x402_payments/, error);
      await expect(createPaymentStore(scripted.pool).beginPayment(input)).rejects.toBeInstanceOf(expected);
    }
    const failure = new Error('database offline');
    const scripted = createScriptedPool();
    scripted.queueError(/^\s*INSERT INTO x402_payments/, failure);
    await expect(createPaymentStore(scripted.pool).beginPayment(input)).rejects.toBe(failure);
  });

  test('persists settlement transitions without overwriting the answer and handles missing completion rows', async () => {
    const scripted = createScriptedPool();
    scripted.queueResult(/SET status = 'settling'/, []);
    scripted.queueResult(/settle_attempts = settle_attempts \+ 1/, []);
    scripted.queueResult(/SET status = 'settled'/, [paymentRow({
      status: 'settled', answer_json: { answer: 'pre-settlement' }, response_body: completion.responseBody,
      amount_settled: '18000', transaction: '0xtx', settled_at: new Date('2025-01-02T00:00:00Z'),
    })]);
    const store = createPaymentStore(scripted.pool);
    await store.beginSettlement('payment-id', { answer: 'pre-settlement' }, requirements);
    await store.markSettlementUnknown('payment-id', 'timeout');
    const completed = await store.completePayment('payment-id', completion);
    expect(completed).toMatchObject({ status: 'settled', amountSettled: '18000', answerBody: { answer: 'pre-settlement' }, responseBody: completion.responseBody });
    expect(scripted.calls[0]?.params[1]).toBe(JSON.stringify({ answer: 'pre-settlement' }));
    expect(scripted.calls[1]?.sql).toContain('settle_attempts = settle_attempts + 1');
    expect(scripted.calls[2]?.sql).not.toContain('answer_json');

    const missing = createScriptedPool();
    missing.queueResult(/SET status = 'settled'/, []);
    await expect(createPaymentStore(missing.pool).completePayment('missing', completion)).rejects.toThrow('Payment was not settling or does not exist.');
  });

  test('fails payments with an optional payer and retries settlements when present', async () => {
    const scripted = createScriptedPool();
    scripted.queueResult(/SET status = 'failed'/, []);
    scripted.queueResult(/SET status = 'settling'.*RETURNING/s, [paymentRow({ status: 'settling', amount_authorized: 20 })]);
    scripted.queueResult(/SET status = 'settling'.*RETURNING/s, []);
    const store = createPaymentStore(scripted.pool);
    await store.failPayment('payment-id', { errorReason: 'rejected' });
    expect(scripted.calls[0]?.sql).toContain('payer = COALESCE($3, payer)');
    expect(scripted.calls[0]?.params).toEqual(['payment-id', 'rejected', null]);
    expect(await store.retrySettlement('payment-id')).toMatchObject({ status: 'settling', amountAuthorized: '20' });
    expect(await store.retrySettlement('missing')).toBeUndefined();
  });

  test('marks settled and failed based on affected row counts', async () => {
    const scripted = createScriptedPool();
    scripted.queueResult(/SET status = 'settled'/, [], 1);
    scripted.queueResult(/SET status = 'settled'/, [], 0);
    scripted.queueResult(/SET status = 'failed'/, [], null);
    scripted.queueResult(/SET status = 'failed'/, [], 2);
    const store = createPaymentStore(scripted.pool);
    expect(await store.markSettled('payment-id', '0xtx')).toBe(true);
    expect(await store.markSettled('missing', '0xtx')).toBe(false);
    expect(await store.markFailed('missing', 'no-op')).toBe(false);
    expect(await store.markFailed('payment-id', 'declined')).toBe(true);
  });

  test('looks up payments and records rejected attempts with an absent payer as null', async () => {
    const scripted = createScriptedPool();
    scripted.queueResult(/SELECT \* FROM x402_payments WHERE payload_fingerprint/, [paymentRow({ payload_fingerprint: 'fingerprint-1' })]);
    scripted.queueResult(/SELECT \* FROM x402_payments WHERE payload_fingerprint/, []);
    scripted.queueResult(/SELECT \* FROM x402_payments WHERE id/, [paymentRow({
      amount_authorized: 20000, amount_settled: null, answer_json: null, response_body: { legacy: true },
    })]);
    scripted.queueResult(/SELECT \* FROM x402_payments WHERE id/, []);
    scripted.queueResult(/INSERT INTO x402_rejected_attempts/, []);
    const store = createPaymentStore(scripted.pool);
    expect(await store.getPaymentByFingerprint('fingerprint-1')).toMatchObject({ id: paymentRow().id });
    expect(await store.getPaymentByFingerprint('missing')).toBeUndefined();
    expect(await store.getPaymentById('payment-id')).toMatchObject({ amountAuthorized: '20000', answerBody: { legacy: true } });
    expect(await store.getPaymentById('missing')).toBeUndefined();
    await store.recordRejectedAttempt({ id: 'reject-id', datasetId: 'dataset-1', mode: 'local', nonce: 'nonce-1', payloadHash: 'hash', reason: 'invalid' });
    expect(scripted.calls[4]?.params[5]).toBeNull();
  });

  test('lists unknown and stale records with default and explicit limits', async () => {
    const row = paymentRow({ status: 'settlement_unknown', settle_attempts: 3 });
    const scripted = createScriptedPool();
    scripted.queueResult(/status = 'settlement_unknown'/, [row]);
    scripted.queueResult(/status = 'settlement_unknown'/, []);
    scripted.queueResult(/status IN \('authorized', 'settling'\)/, [paymentRow({ status: 'authorized' })]);
    scripted.queueResult(/status IN \('authorized', 'settling'\)/, []);
    const store = createPaymentStore(scripted.pool);
    expect(await store.listSettlementUnknown()).toMatchObject([{ status: 'settlement_unknown', settleAttempts: 3 }]);
    expect(await store.listSettlementUnknown(7)).toEqual([]);
    expect(await store.listStaleUnsettled(30)).toMatchObject([{ status: 'authorized' }]);
    expect(await store.listStaleUnsettled(10, 4)).toEqual([]);
    expect(scripted.calls.map(({ params }) => params)).toEqual([[200], [7], [30, 200], [10, 4]]);
  });

  test('maps metrics aggregates and rejects a missing aggregate row', async () => {
    const scripted = createScriptedPool();
    scripted.queueResult(/FILTER \(WHERE status = 'settled'\)/, [{ settled_count: '2', failed_count: 3, unsettled_count: '4', settled_amount: 58000 }]);
    scripted.queueResult(/FROM x402_payments/, []);
    const store = createPaymentStore(scripted.pool);
    expect(await store.metrics()).toEqual({ settledCount: 2, failedCount: 3, unsettledCount: 4, settledAmount: '58000' });
    await expect(store.metrics()).rejects.toThrow('Payment metrics query returned no row.');
  });

  test('resolves stale statuses and skips settled, missing, and concurrently changed rows', async () => {
    const scripted = createScriptedPool();
    scripted.queueResult(/SELECT status FROM x402_payments/, [{ status: 'authorized' }]);
    scripted.queueResult(/SET status = 'failed'/, [], 1);
    scripted.queueResult(/SELECT status FROM x402_payments/, [{ status: 'settling' }]);
    scripted.queueResult(/SET status = 'settlement_unknown'/, [], 1);
    scripted.queueResult(/SELECT status FROM x402_payments/, [{ status: 'settled' }]);
    scripted.queueResult(/SELECT status FROM x402_payments/, []);
    scripted.queueResult(/SELECT status FROM x402_payments/, [{ status: 'authorized' }]);
    scripted.queueResult(/SET status = 'failed'/, [], 0);
    const store = createPaymentStore(scripted.pool);
    expect(await store.resolveStale('authorized')).toBe('abandoned');
    expect(scripted.calls[1]?.sql).toContain("error_reason = 'abandoned_before_settlement'");
    expect(await store.resolveStale('settling')).toBe('unknown');
    expect(scripted.calls[3]?.sql).toContain("settlement_error = 'stale_settling'");
    expect(await store.resolveStale('settled')).toBe('skipped');
    expect(await store.resolveStale('missing')).toBe('skipped');
    expect(await store.resolveStale('raced')).toBe('skipped');
    expect(scripted.calls.filter(({ sql }) => sql.startsWith('UPDATE'))).toHaveLength(3);
  });
});
