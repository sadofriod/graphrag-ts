import type { Pool } from 'pg';
import type { PaymentPayload, PaymentRequirements } from './types.ts';
import { authorizationContractFromPayload } from './payload.ts';

export type PaymentStatus = 'authorized' | 'settling' | 'settled' | 'settlement_unknown' | 'failed';

export type PaymentRecord = {
  readonly id: string;
  readonly requestId: string;
  readonly requestHash: string;
  readonly nonce: string;
  readonly nonceContract: string;
  readonly datasetId: string;
  readonly workspaceId: string | null;
  readonly mode: 'local' | 'global';
  readonly scheme: 'exact' | 'upto';
  readonly network: string;
  readonly asset: string;
  readonly amountAuthorized: string;
  readonly amountSettled: string | null;
  readonly payer: string | null;
  readonly status: PaymentStatus;
  readonly transaction: string | null;
  readonly errorReason: string | null;
  readonly settlementError: string | null;
  readonly settleAttempts: number;
  readonly responseBody: unknown;
  readonly answerBody: unknown;
  readonly payloadFingerprint: string | null;
  readonly payload: PaymentPayload | null;
  readonly requirements: PaymentRequirements | null;
  readonly datasetVersion: string | null;
  readonly latencyMs: number | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly settledAt: Date | null;
};

type PaymentRow = {
  id: string; request_id: string; request_hash: string; nonce: string; nonce_contract: string; nonce_identity: string | null; dataset_id: string; workspace_id: string | null;
  mode: 'local' | 'global'; scheme: 'exact' | 'upto'; network: string; asset: string;
  amount_authorized: string | number; amount_settled: string | number | null; payer: string | null; status: PaymentStatus;
  transaction: string | null; error_reason: string | null; settlement_error: string | null; settle_attempts: number;
  response_body: unknown | null; answer_json: unknown | null; payload_fingerprint: string | null;
  payload_json: PaymentPayload | null; requirements_json: PaymentRequirements | null;
  dataset_version: string | null; latency_ms: number | null; created_at: Date; updated_at: Date; settled_at: Date | null;
};

const mapPayment = (row: PaymentRow): PaymentRecord => ({
  id: row.id, requestId: row.request_id, requestHash: row.request_hash, nonce: row.nonce, nonceContract: row.nonce_contract, datasetId: row.dataset_id,
  workspaceId: row.workspace_id, mode: row.mode, scheme: row.scheme, network: row.network, asset: row.asset,
  amountAuthorized: String(row.amount_authorized), amountSettled: row.amount_settled === null ? null : String(row.amount_settled),
  payer: row.payer, status: row.status, transaction: row.transaction, errorReason: row.error_reason,
  settlementError: row.settlement_error, settleAttempts: row.settle_attempts, responseBody: row.response_body,
  // The response_body fallback preserves answer access for rows created before migration 009.
  answerBody: row.answer_json ?? row.response_body, payloadFingerprint: row.payload_fingerprint,
  payload: row.payload_json, requirements: row.requirements_json, datasetVersion: row.dataset_version,
  latencyMs: row.latency_ms, createdAt: row.created_at, updatedAt: row.updated_at, settledAt: row.settled_at,
});

export class PaymentConflictError extends Error {
  readonly code = 'IDEMPOTENCY_CONFLICT';
  constructor() { super('Payment request id was reused with different payment content.'); this.name = 'PaymentConflictError'; }
}

export class PaymentReplayError extends Error {
  readonly code = 'NONCE_REPLAY';
  constructor() { super('Payment nonce has already been used.'); this.name = 'PaymentReplayError'; }
}

const isUniqueViolation = (error: unknown): error is { code: string; constraint?: string } =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';

export type BeginPaymentInput = {
  readonly id: string; readonly requestId: string; readonly requestHash: string; readonly nonce: string;
  readonly datasetId: string; readonly workspaceId: string; readonly mode: 'local' | 'global';
  readonly scheme: 'exact' | 'upto'; readonly network: string; readonly asset: string; readonly amountAuthorized: string;
  readonly payloadFingerprint: string; readonly payload: PaymentPayload; readonly requirements: PaymentRequirements; readonly payer: string;
};

const loadByFingerprint = async (pool: Pick<Pool, 'query'>, fingerprint: string): Promise<PaymentRecord | undefined> => {
  const result = await pool.query<PaymentRow>('SELECT * FROM x402_payments WHERE payload_fingerprint = $1', [fingerprint]);
  return result.rows[0] ? mapPayment(result.rows[0]) : undefined;
};

type PaymentPool = Pick<Pool, 'query'>;
type CompletePaymentInput = {
  readonly payer: string; readonly transaction: string; readonly amountSettled: string; readonly responseBody: unknown;
  readonly datasetVersion: string; readonly latencyMs: number;
};
type RejectedAttemptInput = {
  readonly id: string; readonly datasetId: string; readonly mode: string; readonly nonce: string;
  readonly payloadHash: string; readonly payer?: string; readonly reason: string;
};

const beginPayment = async (pool: PaymentPool, input: BeginPaymentInput): Promise<{ kind: 'new'; record: PaymentRecord } | { kind: 'replay'; record: PaymentRecord }> => {
  const payer = input.payer.trim().toLowerCase();
  const nonceContract = authorizationContractFromPayload(input.payload);
  try {
    const result = await pool.query<PaymentRow>(
      `INSERT INTO x402_payments
         (id, request_id, request_hash, nonce, nonce_contract, nonce_identity, dataset_id, workspace_id, mode, scheme, network, asset,
          amount_authorized, payload_fingerprint, payload_json, requirements_json, payer, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16::jsonb, $17, 'authorized')
       ON CONFLICT DO NOTHING RETURNING *`,
      [input.id, input.requestId, input.requestHash, input.nonce, nonceContract, input.nonce, input.datasetId, input.workspaceId, input.mode,
        input.scheme, input.network, input.asset, input.amountAuthorized, input.payloadFingerprint,
        JSON.stringify(input.payload), JSON.stringify(input.requirements), payer],
    );
    if (result.rows[0]) return { kind: 'new', record: mapPayment(result.rows[0]) };
    const existing = await loadByFingerprint(pool, input.payloadFingerprint);
    if (existing) return { kind: 'replay', record: existing };
    const replay = await pool.query<{ readonly id: string }>(
      `SELECT id FROM x402_payments
       WHERE network = $1 AND lower(COALESCE(payer, '')) = $2 AND nonce_contract = $3 AND nonce_identity = $4`,
      [input.network, payer, nonceContract, input.nonce],
    );
    if (replay.rows[0]) throw new PaymentReplayError();
    throw new PaymentConflictError();
  } catch (error) {
    if (isUniqueViolation(error)) {
      if ((error.constraint ?? '').toLowerCase().includes('replay_scope')) throw new PaymentReplayError();
      throw new PaymentConflictError();
    }
    throw error;
  }
};

const recordRejectedAttempt = async (pool: PaymentPool, input: RejectedAttemptInput): Promise<void> => {
  await pool.query(
    `INSERT INTO x402_rejected_attempts (id, dataset_id, mode, nonce, payload_hash, payer, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [input.id, input.datasetId, input.mode, input.nonce, input.payloadHash, input.payer ?? null, input.reason],
  );
};

const beginSettlement = async (pool: PaymentPool, id: string, answer: unknown, requirements: PaymentRequirements): Promise<boolean> => {
  const result = await pool.query(
    `UPDATE x402_payments SET status = 'settling', answer_json = $2::jsonb, requirements_json = $3::jsonb, updated_at = now()
     WHERE id = $1 AND status = 'authorized'`, [id, JSON.stringify(answer), JSON.stringify(requirements)],
  );
  return (result.rowCount ?? 0) > 0;
};

const markSettlementUnknown = async (pool: PaymentPool, id: string, error: string): Promise<void> => {
  await pool.query(
    `UPDATE x402_payments SET status = 'settlement_unknown', settlement_error = $2,
       settle_attempts = settle_attempts + 1, updated_at = now()
     WHERE id = $1 AND status = 'settling'`, [id, error],
  );
};

const completePayment = async (pool: PaymentPool, id: string, input: CompletePaymentInput): Promise<PaymentRecord> => {
  const result = await pool.query<PaymentRow>(
    `UPDATE x402_payments SET status = 'settled', payer = lower($2), transaction = $3, amount_settled = $4,
        response_body = $5::jsonb, dataset_version = $6,
       latency_ms = $7, settled_at = now(), updated_at = now()
     WHERE id = $1 AND status IN ('settling', 'settlement_unknown') RETURNING *`,
    [id, input.payer, input.transaction, input.amountSettled, JSON.stringify(input.responseBody), input.datasetVersion, input.latencyMs],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Payment was not settling or does not exist.');
  return mapPayment(row);
};

const failPayment = async (pool: PaymentPool, id: string, input: { readonly errorReason: string; readonly payer?: string }): Promise<void> => {
  await pool.query(
    `UPDATE x402_payments SET status = 'failed', error_reason = $2,
       payer = COALESCE(lower($3), payer), updated_at = now()
     WHERE id = $1 AND status IN ('authorized', 'settling', 'settlement_unknown')`,
    [id, input.errorReason, input.payer ?? null],
  );
};

const retrySettlement = async (pool: PaymentPool, id: string): Promise<PaymentRecord | undefined> => {
  const result = await pool.query<PaymentRow>(
    `UPDATE x402_payments SET status = 'settling', updated_at = now()
     WHERE id = $1 AND status = 'settlement_unknown' RETURNING *`, [id],
  );
  return result.rows[0] ? mapPayment(result.rows[0]) : undefined;
};

const markSettled = async (pool: PaymentPool, id: string, transaction: string): Promise<boolean> => {
  const result = await pool.query(
    `UPDATE x402_payments SET status = 'settled', transaction = $2, settled_at = now(), updated_at = now()
     WHERE id = $1 AND status IN ('settlement_unknown', 'settling')`, [id, transaction],
  );
  return (result.rowCount ?? 0) > 0;
};

const markFailed = async (pool: PaymentPool, id: string, reason: string): Promise<boolean> => {
  const result = await pool.query(
    `UPDATE x402_payments SET status = 'failed', error_reason = $2, updated_at = now()
     WHERE id = $1 AND status IN ('settlement_unknown', 'settling')`, [id, reason],
  );
  return (result.rowCount ?? 0) > 0;
};

const listSettlementUnknown = async (pool: PaymentPool, limit = 200): Promise<readonly PaymentRecord[]> => {
  const result = await pool.query<PaymentRow>("SELECT * FROM x402_payments WHERE status = 'settlement_unknown' ORDER BY created_at LIMIT $1", [limit]);
  return result.rows.map(mapPayment);
};

const listStaleUnsettled = async (pool: PaymentPool, olderThanMinutes: number, limit = 200): Promise<readonly PaymentRecord[]> => {
  const result = await pool.query<PaymentRow>(
    `SELECT * FROM x402_payments
     WHERE status IN ('authorized', 'settling') AND updated_at < now() - ($1::int * interval '1 minute')
      ORDER BY created_at LIMIT $2`, [olderThanMinutes, limit],
  );
  return result.rows.map(mapPayment);
};

const resolveStale = async (pool: PaymentPool, id: string): Promise<'abandoned' | 'unknown' | 'skipped'> => {
  const current = await pool.query<{ status: PaymentStatus }>('SELECT status FROM x402_payments WHERE id = $1', [id]);
  const status = current.rows[0]?.status;
  if (status !== 'authorized' && status !== 'settling') return 'skipped';
  const target = status === 'authorized' ? 'failed' : 'settlement_unknown';
  const reasonColumn = status === 'authorized' ? "error_reason = 'abandoned_before_settlement'" : "settlement_error = 'stale_settling'";
  const updated = await pool.query(
    `UPDATE x402_payments SET status = '${target}', ${reasonColumn}, updated_at = now()
     WHERE id = $1 AND status = $2`, [id, status],
  );
  if ((updated.rowCount ?? 0) === 0) return 'skipped';
  return status === 'authorized' ? 'abandoned' : 'unknown';
};

const getPaymentById = async (pool: PaymentPool, id: string): Promise<PaymentRecord | undefined> => {
  const result = await pool.query<PaymentRow>('SELECT * FROM x402_payments WHERE id = $1', [id]);
  return result.rows[0] ? mapPayment(result.rows[0]) : undefined;
};

const paymentMetrics = async (pool: PaymentPool): Promise<{ settledCount: number; failedCount: number; unsettledCount: number; settledAmount: string }> => {
  const result = await pool.query<{ settled_count: string | number; failed_count: string | number; unsettled_count: string | number; settled_amount: string | number }>(
    `SELECT count(*) FILTER (WHERE status = 'settled') AS settled_count,
            count(*) FILTER (WHERE status = 'failed') AS failed_count,
            count(*) FILTER (WHERE status IN ('authorized', 'settling', 'settlement_unknown')) AS unsettled_count,
            COALESCE(sum(amount_settled) FILTER (WHERE status = 'settled'), 0) AS settled_amount
     FROM x402_payments`,
  );
  const row = result.rows[0];
  if (!row) throw new Error('Payment metrics query returned no row.');
  return { settledCount: Number(row.settled_count), failedCount: Number(row.failed_count), unsettledCount: Number(row.unsettled_count), settledAmount: String(row.settled_amount) };
};

export const createPaymentStore = (pool: PaymentPool) => ({
  getPaymentByFingerprint: (fingerprint: string) => loadByFingerprint(pool, fingerprint),
  beginPayment: (input: BeginPaymentInput) => beginPayment(pool, input),
  recordRejectedAttempt: (input: RejectedAttemptInput) => recordRejectedAttempt(pool, input),
  beginSettlement: (id: string, answer: unknown, requirements: PaymentRequirements) => beginSettlement(pool, id, answer, requirements),
  markSettlementUnknown: (id: string, error: string) => markSettlementUnknown(pool, id, error),
  completePayment: (id: string, input: CompletePaymentInput) => completePayment(pool, id, input),
  failPayment: (id: string, input: { readonly errorReason: string; readonly payer?: string }) => failPayment(pool, id, input),
  retrySettlement: (id: string) => retrySettlement(pool, id),
  markSettled: (id: string, transaction: string) => markSettled(pool, id, transaction),
  markFailed: (id: string, reason: string) => markFailed(pool, id, reason),
  listSettlementUnknown: (limit?: number) => listSettlementUnknown(pool, limit),
  listStaleUnsettled: (olderThanMinutes: number, limit?: number) => listStaleUnsettled(pool, olderThanMinutes, limit),
  resolveStale: (id: string) => resolveStale(pool, id),
  getPaymentById: (id: string) => getPaymentById(pool, id),
  metrics: () => paymentMetrics(pool),
});

export type PaymentStore = ReturnType<typeof createPaymentStore>;
export type PaymentLedger = Pick<PaymentStore,
  | 'getPaymentByFingerprint'
  | 'beginPayment'
  | 'recordRejectedAttempt'
  | 'beginSettlement'
  | 'markSettlementUnknown'
  | 'completePayment'
  | 'failPayment'
>;
export type PaymentAdmin = Pick<PaymentStore,
  | 'retrySettlement'
  | 'markSettled'
  | 'markFailed'
  | 'listSettlementUnknown'
  | 'listStaleUnsettled'
  | 'resolveStale'
  | 'getPaymentById'
  | 'metrics'
>;
