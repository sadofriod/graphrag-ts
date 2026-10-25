import type { Pool } from 'pg';
import type { PaymentPayload, PaymentRequirements } from './types.ts';

export type PaymentTestRow = {
  id: string;
  request_id: string;
  request_hash: string;
  nonce: string;
  nonce_contract: string;
  nonce_identity: string | null;
  dataset_id: string;
  workspace_id: string | null;
  mode: 'local' | 'global';
  scheme: 'exact' | 'upto';
  network: string;
  asset: string;
  amount_authorized: string | number;
  amount_settled: string | number | null;
  payer: string | null;
  status: 'authorized' | 'settling' | 'settled' | 'settlement_unknown' | 'failed';
  transaction: string | null;
  error_reason: string | null;
  settlement_error: string | null;
  settle_attempts: number;
  response_body: unknown | null;
  answer_json: unknown | null;
  payload_fingerprint: string | null;
  payload_json: PaymentPayload | null;
  requirements_json: PaymentRequirements | null;
  dataset_version: string | null;
  latency_ms: number | null;
  created_at: Date;
  updated_at: Date;
  settled_at: Date | null;
};

type Script = {
  readonly matcher: RegExp;
  readonly outcome: { readonly rows: unknown[]; readonly rowCount: number | null } | { readonly error: unknown };
};

export const paymentRow = (overrides: Partial<PaymentTestRow> = {}): PaymentTestRow => ({
  id: '00000000-0000-4000-8000-000000000001',
  request_id: 'request-1',
  request_hash: 'request-hash',
  nonce: 'nonce-1',
  nonce_contract: '0xasset',
  nonce_identity: 'nonce-1',
  dataset_id: 'dataset-1',
  workspace_id: 'workspace-1',
  mode: 'local',
  scheme: 'exact',
  network: 'eip155:84532',
  asset: '0xasset',
  amount_authorized: '20000',
  amount_settled: null,
  payer: '0xbuyer',
  status: 'authorized',
  transaction: null,
  error_reason: null,
  settlement_error: null,
  settle_attempts: 0,
  response_body: null,
  answer_json: null,
  payload_fingerprint: 'fingerprint-1',
  payload_json: null,
  requirements_json: null,
  dataset_version: null,
  latency_ms: null,
  created_at: new Date('2025-01-01T00:00:00.000Z'),
  updated_at: new Date('2025-01-01T00:00:00.000Z'),
  settled_at: null,
  ...overrides,
});

export const createScriptedPool = () => {
  const calls: { readonly sql: string; readonly params: readonly unknown[] }[] = [];
  const scripts: Script[] = [];
  const queueResult = (matcher: RegExp, rows: readonly unknown[], rowCount: number | null = rows.length): void => {
    scripts.push({ matcher, outcome: { rows: [...rows], rowCount } });
  };
  const queueError = (matcher: RegExp, error: unknown): void => {
    scripts.push({ matcher, outcome: { error } });
  };
  const reset = (): void => {
    calls.length = 0;
    scripts.length = 0;
  };
  const query = async (sql: string, params?: readonly unknown[]) => {
    calls.push({ sql, params: params ?? [] });
    const index = scripts.findIndex((script) => {
      script.matcher.lastIndex = 0;
      return script.matcher.test(sql);
    });
    if (index < 0) throw new Error(`unexpected SQL: ${sql}`);
    const [script] = scripts.splice(index, 1);
    if (!script) throw new Error(`unexpected SQL: ${sql}`);
    if ('error' in script.outcome) throw script.outcome.error;
    return { rows: script.outcome.rows, rowCount: script.outcome.rowCount };
  };

  return { pool: { query } as unknown as Pick<Pool, 'query'>, calls, queueResult, queueError, reset };
};
