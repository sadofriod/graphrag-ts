import { describe, expect, test } from 'bun:test';
import { createPaymentStore, PaymentConflictError, PaymentReplayError } from './payments.ts';

type Row = {
  id: string; request_id: string; request_hash: string; nonce: string; dataset_id: string; mode: 'local' | 'global';
  scheme: 'exact' | 'upto'; network: string; asset: string; amount_authorized: string | number; amount_settled: string | number | null;
  payer: string | null; status: 'authorized' | 'settling' | 'settled' | 'settlement_unknown' | 'failed'; transaction: string | null; error_reason: string | null;
  workspace_id?: string | null; payload_fingerprint?: string | null; payload_json?: unknown | null; requirements_json?: unknown | null;
  answer_json?: unknown | null; settlement_error?: string | null; settle_attempts?: number;
  response_body: unknown | null; dataset_version: string | null; latency_ms: number | null; created_at: Date; updated_at: Date; settled_at: Date | null;
};

const row: Row = {
  id: 'id', request_id: 'request', request_hash: 'hash', nonce: 'nonce', dataset_id: 'dataset', mode: 'local', scheme: 'exact',
  network: 'eip155:84532', asset: 'USDC', amount_authorized: '20000', amount_settled: null, payer: null, status: 'authorized',
  transaction: null, error_reason: null, response_body: null, dataset_version: null, latency_ms: null, created_at: new Date(0), updated_at: new Date(0), settled_at: null,
  workspace_id: 'workspace', payload_fingerprint: 'fingerprint', payload_json: null, requirements_json: null,
  answer_json: null, settlement_error: null, settle_attempts: 0,
};

const payload = { x402Version: 2 as const, accepted: { scheme: 'exact', network: 'eip155:84532', amount: '20000', asset: 'USDC', payTo: 'payee', maxTimeoutSeconds: 60 }, payload: { authorization: { nonce: 'nonce' } } };
const requirements = { ...payload.accepted, amount: '20000' };
const input = { id: 'id', requestId: 'request', requestHash: 'hash', nonce: 'nonce', datasetId: 'dataset', workspaceId: 'workspace', mode: 'local' as const, scheme: 'exact' as const, network: 'eip155:84532', asset: 'USDC', amountAuthorized: '20000', payloadFingerprint: 'fingerprint', payload, requirements, payer: 'payer' };

const fakePool = (query: (sql: string, params?: readonly unknown[]) => Promise<{ rows: Row[] }>) =>
  ({ query }) as never;

describe('x402 payment ledger', () => {
  test('creates a new payment and returns an idempotent replay', async () => {
    const calls: string[] = [];
    const pool = fakePool(async (sql) => {
      calls.push(sql);
      if (sql.startsWith('INSERT')) return { rows: calls.length === 1 ? [{ ...row, payload_json: payload, requirements_json: requirements, payer: 'payer' }] : [] };
      return { rows: [{ ...row }] };
    });
    const store = createPaymentStore(pool);
    expect(await store.beginPayment(input)).toMatchObject({ kind: 'new', record: { amountAuthorized: '20000' } });
    expect(await store.beginPayment(input)).toMatchObject({ kind: 'replay', record: { requestHash: 'hash' } });
    expect(calls[0]).toContain('ON CONFLICT DO NOTHING RETURNING *');
  });

  test('detects idempotency conflicts and nonce replay errors', async () => {
    const conflictStore = createPaymentStore(fakePool(async (sql) => ({ rows: sql.startsWith('INSERT') ? [] : [] })));
    await expect(conflictStore.beginPayment(input)).rejects.toBeInstanceOf(PaymentConflictError);
    const replayStore = createPaymentStore(fakePool(async () => { throw { code: '23505', constraint: 'x402_payments_nonce_key' }; }));
    await expect(replayStore.beginPayment(input)).rejects.toBeInstanceOf(PaymentReplayError);
    const unknownStore = createPaymentStore(fakePool(async () => { throw { code: '23505', constraint: 'unknown_key' }; }));
    await expect(unknownStore.beginPayment(input)).rejects.toBeInstanceOf(PaymentConflictError);
  });

  test('completes pending payments and does not fail settled records', async () => {
    const calls: { sql: string; params?: readonly unknown[] }[] = [];
    const store = createPaymentStore(fakePool(async (sql, params) => {
      calls.push({ sql, ...(params ? { params } : {}) });
      if (sql.startsWith('UPDATE') && sql.includes("status = 'settled'")) {
        return { rows: [{ ...row, status: 'settled', amount_settled: '18000', payer: 'payer', transaction: 'tx', settled_at: new Date() }] };
      }
      return { rows: [] };
    }));
    expect(await store.completePayment('id', { payer: 'payer', transaction: 'tx', amountSettled: '18000', responseBody: {}, datasetVersion: 'v1', latencyMs: 3 })).toMatchObject({ status: 'settled', amountSettled: '18000' });
    await store.failPayment('id', { errorReason: 'retrieval failed' });
    expect(calls[1]?.sql).toContain("status IN ('authorized', 'settling', 'settlement_unknown')");
  });

  test('persists the answer before settlement and increments unknown settlement attempts', async () => {
    const calls: { sql: string; params?: readonly unknown[] }[] = [];
    const store = createPaymentStore(fakePool(async (sql, params) => {
      calls.push({ sql, ...(params ? { params } : {}) });
      return { rows: [] };
    }));
    await store.beginSettlement('id', { answer: 'generated' }, requirements);
    await store.markSettlementUnknown('id', 'timeout');
    expect(calls[0]?.sql).toContain("status = 'settling', answer_json = $2::jsonb");
    expect(calls[0]?.params?.[1]).toBe(JSON.stringify({ answer: 'generated' }));
    expect(calls[1]?.sql).toContain('settle_attempts = settle_attempts + 1');
    expect(calls[1]?.sql).toContain("status = 'settlement_unknown'");
  });

  test('maps metrics from one FILTER aggregate query', async () => {
    let calls = 0;
    const store = createPaymentStore(fakePool(async (sql) => {
      calls++;
      expect(sql).toContain('FILTER (WHERE status');
      return { rows: [{ settled_count: '2', failed_count: '3', pending_count: '4', settled_amount: '58000' } as unknown as Row] };
    }));
    expect(await store.metrics()).toEqual({ settledCount: 2, failedCount: 3, pendingCount: 4, settledAmount: '58000' });
    expect(calls).toBe(1);
  });
});
