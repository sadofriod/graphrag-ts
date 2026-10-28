import { Pool } from 'pg';
import { createCdpFacilitatorClient } from '../src/x402/cdp.ts';
import { createFacilitatorClient } from '../src/x402/facilitator.ts';
import { createPaymentStore, type PaymentRecord } from '../src/x402/payments.ts';
import type { PaymentPayload, PaymentRequirements } from '../src/x402/types.ts';

type Args = { action: 'list' | 'sweep' | 'retry' | 'mark-settled' | 'mark-failed'; paymentId?: string; tx?: string; reason?: string; olderThanMinutes?: number };

const usage = 'Usage: --list [--older-than-minutes <n>] | --sweep [--older-than-minutes <n>] | --retry <payment_id> | --mark-settled <payment_id> --tx <hash> | --mark-failed <payment_id> --reason <text>';

const parseOlderThan = (argv: readonly string[], action: 'list' | 'sweep'): Args | undefined => {
  if (argv[0] !== `--${action}`) return undefined;
  if (argv.length === 1) return { action, olderThanMinutes: 30 };
  if (argv.length !== 3 || argv[1] !== '--older-than-minutes' || !/^\d+$/.test(argv[2] ?? '')) return undefined;
  const olderThanMinutes = Number(argv[2]);
  return Number.isSafeInteger(olderThanMinutes) && olderThanMinutes <= 2_147_483_647
    ? { action, olderThanMinutes }
    : undefined;
};

const parseRetryArgs = (argv: readonly string[]): Args | undefined =>
  argv[0] === '--retry' && argv[1] ? { action: 'retry', paymentId: argv[1] } : undefined;

const parseSettledArgs = (argv: readonly string[]): Args | undefined => {
  if (argv[0] !== '--mark-settled' || !argv[1] || argv[2] !== '--tx' || !argv[3]) return undefined;
  return { action: 'mark-settled', paymentId: argv[1], tx: argv[3] };
};

const parseFailedArgs = (argv: readonly string[]): Args | undefined => {
  if (argv[0] !== '--mark-failed' || !argv[1] || argv[2] !== '--reason' || !argv[3]) return undefined;
  return { action: 'mark-failed', paymentId: argv[1], reason: argv.slice(3).join(' ') };
};

const parseArgs = (argv: readonly string[]): Args => {
  const args = parseOlderThan(argv, 'list') ?? parseOlderThan(argv, 'sweep') ?? parseRetryArgs(argv) ?? parseSettledArgs(argv) ?? parseFailedArgs(argv);
  if (!args) throw new Error(usage);
  return args;
};

const ageMinutes = (createdAt: Date): number => Math.floor((Date.now() - createdAt.getTime()) / 60_000);

const printPayment = (payment: PaymentRecord): void => {
  console.log(`${payment.id} request=${payment.requestId} status=${payment.status} dataset=${payment.datasetId} amount=${payment.amountAuthorized} age=${ageMinutes(payment.createdAt)}m attempts=${payment.settleAttempts}`);
};

const listPayments = async (pool: Pool, olderThanMinutes: number): Promise<void> => {
  const payments = createPaymentStore(pool);
  const limit = 200;
  const [unknown, stale] = await Promise.all([payments.listSettlementUnknown(limit), payments.listStaleUnsettled(olderThanMinutes, limit)]);
  for (const payment of [...unknown, ...stale]) printPayment(payment);
  console.log(`Listed ${unknown.length + stale.length} unsettled payment(s) (limit=${limit} per list; results may be truncated).`);
};

const sweepPayments = async (pool: Pool, olderThanMinutes: number): Promise<void> => {
  const payments = createPaymentStore(pool);
  const stale = await payments.listStaleUnsettled(olderThanMinutes);
  for (const payment of stale) {
    const outcome = await payments.resolveStale(payment.id);
    console.log(`${payment.id} request=${payment.requestId} status=${payment.status} dataset=${payment.datasetId} amount=${payment.amountAuthorized} age=${ageMinutes(payment.createdAt)}m attempts=${payment.settleAttempts} outcome=${outcome}`);
  }
  console.log(`Swept ${stale.length} stale payment(s).`);
};

export const markSettled = async (pool: Pool, id: string, tx: string | undefined): Promise<void> => {
  const result = await pool.query(
    `UPDATE x402_payments SET status = 'settled', transaction = $2, settled_at = now(), updated_at = now(),
        amount_settled = COALESCE(NULLIF(requirements_json->>'amount', '')::numeric,
          NULLIF(answer_json #>> '{payment,amount}', '')::numeric, amount_settled),
        response_body = jsonb_set(COALESCE(answer_json, '{}'::jsonb), '{payment,transaction}', to_jsonb($2::text), true)
     WHERE id = $1 AND status IN ('settlement_unknown', 'settling')`, [id, tx],
  );
  if ((result.rowCount ?? 0) === 0) throw new Error(`Unknown payment id: ${id}`);
  console.log(`Marked payment ${id} settled with transaction ${tx}.`);
};

const markFailed = async (pool: Pool, id: string, reason: string | undefined): Promise<void> => {
  const result = await pool.query("UPDATE x402_payments SET status = 'failed', error_reason = $2, updated_at = now() WHERE id = $1 AND status IN ('settlement_unknown', 'settling')", [id, reason]);
  if ((result.rowCount ?? 0) === 0) throw new Error(`Unknown payment id: ${id}`);
  console.log(`Marked payment ${id} failed: ${reason}.`);
};

export const configuredFacilitator = (facilitatorUrl: string) => {
  const apiKeyId = process.env.CDP_API_KEY_ID;
  const apiKeySecret = process.env.CDP_API_KEY_SECRET;
  if (Boolean(apiKeyId) !== Boolean(apiKeySecret)) {
    throw new Error(`Missing required CDP setting: ${apiKeyId ? 'CDP_API_KEY_SECRET' : 'CDP_API_KEY_ID'}.`);
  }
  if (apiKeyId && apiKeySecret && new URL(facilitatorUrl).hostname === 'api.cdp.coinbase.com') {
    return createCdpFacilitatorClient({ apiKeyId, apiKeySecret, baseUrl: facilitatorUrl });
  }
  return createFacilitatorClient({ url: facilitatorUrl });
};

const retrySettlement = async (pool: Pool, id: string): Promise<void> => {
  const facilitatorUrl = process.env.X402_FACILITATOR_URL;
  if (!facilitatorUrl) throw new Error('X402_FACILITATOR_URL is missing.');
  const facilitator = configuredFacilitator(facilitatorUrl);
  const claimed = await pool.query<{
    id: string; payload_json: PaymentPayload | null; requirements_json: PaymentRequirements | null;
    amount_authorized: string; answer_json: Record<string, unknown> | null; settle_attempts: number;
  }>(
    `UPDATE x402_payments SET status = 'settling', updated_at = now()
     WHERE id = $1 AND status = 'settlement_unknown' RETURNING id, payload_json, requirements_json, amount_authorized::text, answer_json, settle_attempts`, [id],
  );
  const payment = claimed.rows[0];
  if (!payment) throw new Error(`Unknown payment id: ${id}`);
  if (!payment.payload_json || !payment.requirements_json) throw new Error(`Payment ${id} has no stored settlement payload.`);
  let settlement;
  try {
    settlement = await facilitator.settle({ paymentPayload: payment.payload_json, paymentRequirements: payment.requirements_json });
  } catch (error) {
    await pool.query("UPDATE x402_payments SET status = 'settlement_unknown', settlement_error = $2, settle_attempts = settle_attempts + 1, updated_at = now() WHERE id = $1 AND status = 'settling'", [id, error instanceof Error ? error.message : 'Settlement transport failed.']);
    console.log(`Settlement retry for ${id} remains unknown (attempt ${payment.settle_attempts + 1}).`);
    return;
  }
  await persistRetryResult(pool, id, payment, settlement);
};

export const persistRetryResult = async (
  pool: Pool,
  id: string,
  payment: {
    answer_json: Record<string, unknown> | null;
    requirements_json: PaymentRequirements | null;
    amount_authorized: string;
    settle_attempts: number;
  },
  settlement: Awaited<ReturnType<ReturnType<typeof createFacilitatorClient>['settle']>>,
): Promise<void> => {
  try {
    if (settlement.success) await persistSuccessfulRetry(pool, id, payment, settlement);
    else await persistRejectedRetry(pool, id, settlement.errorReason, settlement.payer);
  } catch {
    throw new Error(`Failed to persist retry result for ${id}.`);
  }
};

const persistRejectedRetry = async (pool: Pool, id: string, reason: string | undefined, payer: string | undefined): Promise<void> => {
  await pool.query("UPDATE x402_payments SET status = 'settlement_unknown', settlement_error = $2, payer = COALESCE(lower($3), payer), settle_attempts = settle_attempts + 1, updated_at = now() WHERE id = $1 AND status = 'settling'", [id, reason ?? 'Settlement retry was rejected.', payer?.trim() ? payer : null]);
  console.log(`Settlement retry for ${id} was rejected; outcome remains unknown.`);
};

const persistSuccessfulRetry = async (
  pool: Pool,
  id: string,
  payment: {
    answer_json: Record<string, unknown> | null;
    requirements_json: PaymentRequirements | null;
    amount_authorized: string;
  },
  settlement: Awaited<ReturnType<ReturnType<typeof createFacilitatorClient>['settle']>>,
): Promise<void> => {
  const answer = payment.answer_json ?? {};
  const bodyPayment = typeof answer.payment === 'object' && answer.payment !== null ? answer.payment as Record<string, unknown> : {};
  const amountSettled = settlement.amount ?? payment.requirements_json?.amount
    ?? (typeof bodyPayment.amount === 'string' ? bodyPayment.amount : payment.amount_authorized);
  const updatedAnswer = { ...answer, payment: { ...bodyPayment, amount: amountSettled, transaction: settlement.transaction } };
  await pool.query(
    `UPDATE x402_payments SET status = 'settled', transaction = $2, payer = COALESCE(lower($3), payer),
        amount_settled = COALESCE($4::numeric, NULLIF(requirements_json->>'amount', '')::numeric,
          NULLIF(answer_json #>> '{payment,amount}', '')::numeric, amount_authorized), response_body = $5::jsonb,
       settled_at = now(), settlement_error = NULL, updated_at = now() WHERE id = $1 AND status = 'settling'`,
    [id, settlement.transaction, settlement.payer?.trim() ? settlement.payer : null, settlement.amount ?? null, JSON.stringify(updatedAnswer)],
  );
  console.log(`Settlement retry for ${id} succeeded with transaction ${settlement.transaction}.`);
};

const dispatch = async (pool: Pool, args: Args): Promise<void> => {
  if (args.action === 'list') return listPayments(pool, args.olderThanMinutes ?? 30);
  if (args.action === 'sweep') return sweepPayments(pool, args.olderThanMinutes ?? 30);
  const id = args.paymentId as string;
  if (args.action === 'mark-settled') return markSettled(pool, id, args.tx);
  if (args.action === 'mark-failed') return markFailed(pool, id, args.reason);
  return retrySettlement(pool, id);
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is missing.');
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await dispatch(pool, args);
  } finally {
    await pool.end();
  }
};

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Payment reconciliation failed.');
    process.exitCode = 1;
  });
}
