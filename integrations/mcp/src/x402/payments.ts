import type { Pool } from 'pg';

export type PaymentStatus = 'pending' | 'settled' | 'failed';

export type PaymentRecord = {
  readonly id: string;
  readonly requestId: string;
  readonly requestHash: string;
  readonly nonce: string;
  readonly datasetId: string;
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
  readonly responseBody: unknown | null;
  readonly datasetVersion: string | null;
  readonly latencyMs: number | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly settledAt: Date | null;
};

type PaymentRow = {
  id: string;
  request_id: string;
  request_hash: string;
  nonce: string;
  dataset_id: string;
  mode: 'local' | 'global';
  scheme: 'exact' | 'upto';
  network: string;
  asset: string;
  amount_authorized: string | number;
  amount_settled: string | number | null;
  payer: string | null;
  status: PaymentStatus;
  transaction: string | null;
  error_reason: string | null;
  response_body: unknown | null;
  dataset_version: string | null;
  latency_ms: number | null;
  created_at: Date;
  updated_at: Date;
  settled_at: Date | null;
};

const mapPayment = (row: PaymentRow): PaymentRecord => ({
  id: row.id,
  requestId: row.request_id,
  requestHash: row.request_hash,
  nonce: row.nonce,
  datasetId: row.dataset_id,
  mode: row.mode,
  scheme: row.scheme,
  network: row.network,
  asset: row.asset,
  amountAuthorized: String(row.amount_authorized),
  amountSettled: row.amount_settled === null ? null : String(row.amount_settled),
  payer: row.payer,
  status: row.status,
  transaction: row.transaction,
  errorReason: row.error_reason,
  responseBody: row.response_body,
  datasetVersion: row.dataset_version,
  latencyMs: row.latency_ms,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  settledAt: row.settled_at,
});

export class PaymentConflictError extends Error {
  readonly code = 'IDEMPOTENCY_CONFLICT';
  constructor() { super('Payment request id was reused with different request content.'); this.name = 'PaymentConflictError'; }
}

export class PaymentReplayError extends Error {
  readonly code = 'NONCE_REPLAY';
  constructor() { super('Payment nonce has already been used.'); this.name = 'PaymentReplayError'; }
}

const isUniqueViolation = (error: unknown): error is { code: string; constraint?: string } =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';

type BeginPaymentInput = {
  readonly id: string;
  readonly requestId: string;
  readonly requestHash: string;
  readonly nonce: string;
  readonly datasetId: string;
  readonly mode: 'local' | 'global';
  readonly scheme: 'exact' | 'upto';
  readonly network: string;
  readonly asset: string;
  readonly amountAuthorized: string;
};

const insertPendingPayment = async (pool: Pick<Pool, 'query'>, input: BeginPaymentInput): Promise<PaymentRecord | undefined> => {
  try {
    const inserted = await pool.query<PaymentRow>(
      `INSERT INTO x402_payments
         (id, request_id, request_hash, nonce, dataset_id, mode, scheme, network, asset, amount_authorized, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
       ON CONFLICT (request_id) DO NOTHING RETURNING *`,
      [input.id, input.requestId, input.requestHash, input.nonce, input.datasetId, input.mode, input.scheme,
        input.network, input.asset, input.amountAuthorized],
    );
    const row = inserted.rows[0];
    return row ? mapPayment(row) : undefined;
  } catch (error) {
    if (isUniqueViolation(error)) {
      const constraint = error.constraint ?? '';
      if (constraint.toLowerCase().includes('nonce')) throw new PaymentReplayError();
      throw new PaymentConflictError();
    }
    throw error;
  }
};

const loadExistingPayment = async (
  pool: Pick<Pool, 'query'>,
  input: BeginPaymentInput,
): Promise<{ kind: 'replay'; record: PaymentRecord }> => {
  const existing = await pool.query<PaymentRow>('SELECT * FROM x402_payments WHERE request_id = $1', [input.requestId]);
  const row = existing.rows[0];
  if (!row) throw new Error('Payment insert conflict did not have a matching request record.');
  const record = mapPayment(row);
  if (record.requestHash !== input.requestHash) throw new PaymentConflictError();
  return { kind: 'replay', record };
};

export const createPaymentStore = (pool: Pick<Pool, 'query'>) => ({
  beginPayment: async (input: BeginPaymentInput): Promise<{ kind: 'new'; record: PaymentRecord } | { kind: 'replay'; record: PaymentRecord }> => {
    const record = await insertPendingPayment(pool, input);
    if (record) return { kind: 'new', record };
    return loadExistingPayment(pool, input);
  },
  completePayment: async (id: string, input: {
    readonly payer: string;
    readonly transaction: string;
    readonly amountSettled: string;
    readonly responseBody: unknown;
    readonly datasetVersion: string;
    readonly latencyMs: number;
  }): Promise<PaymentRecord> => {
    const result = await pool.query<PaymentRow>(
      `UPDATE x402_payments SET status = 'settled', payer = $2, transaction = $3, amount_settled = $4,
         response_body = $5::jsonb, dataset_version = $6, latency_ms = $7, settled_at = now(), updated_at = now()
       WHERE id = $1 AND status = 'pending' RETURNING *`,
      [id, input.payer, input.transaction, input.amountSettled, JSON.stringify(input.responseBody), input.datasetVersion, input.latencyMs],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Payment was not pending or does not exist.');
    return mapPayment(row);
  },
  failPayment: async (id: string, input: { readonly errorReason: string; readonly payer?: string }): Promise<void> => {
    await pool.query(
      `UPDATE x402_payments SET status = 'failed', error_reason = $2,
         payer = COALESCE($3, payer), updated_at = now()
       WHERE id = $1 AND status <> 'settled'`,
      [id, input.errorReason, input.payer ?? null],
    );
  },
  getPaymentById: async (id: string): Promise<PaymentRecord | undefined> => {
    const result = await pool.query<PaymentRow>('SELECT * FROM x402_payments WHERE id = $1', [id]);
    const row = result.rows[0];
    return row ? mapPayment(row) : undefined;
  },
  metrics: async (): Promise<{ settledCount: number; failedCount: number; pendingCount: number; settledAmount: string }> => {
    const result = await pool.query<{ settled_count: string | number; failed_count: string | number; pending_count: string | number; settled_amount: string | number }>(
      `SELECT count(*) FILTER (WHERE status = 'settled') AS settled_count,
              count(*) FILTER (WHERE status = 'failed') AS failed_count,
              count(*) FILTER (WHERE status = 'pending') AS pending_count,
              COALESCE(sum(amount_settled) FILTER (WHERE status = 'settled'), 0) AS settled_amount
       FROM x402_payments`,
    );
    const row = result.rows[0];
    if (!row) throw new Error('Payment metrics query returned no row.');
    return {
      settledCount: Number(row.settled_count),
      failedCount: Number(row.failed_count),
      pendingCount: Number(row.pending_count),
      settledAmount: String(row.settled_amount),
    };
  },
});

export type PaymentStore = ReturnType<typeof createPaymentStore>;
