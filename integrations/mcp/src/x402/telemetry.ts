import type { Pool } from 'pg';

export type SettlementRow = {
  readonly network: string;
  readonly settled: number;
  readonly settledAtomic: string;
  readonly lastSettledAt: string | null;
};

type SettlementDbRow = {
  readonly network: string;
  readonly settled: number | string;
  readonly settled_atomic: string;
  readonly last_settled_at: Date | string | null;
};

type RecentSettlementDbRow = {
  readonly network: string;
  readonly amount_settled: string;
  readonly transaction: string;
  readonly settled_at: Date | string;
};

type PublicCallDbRow = {
  readonly calls: number | string;
  readonly callers: number | string;
  readonly p95_latency_ms: number | string;
};

const toIsoString = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

export const createTelemetryStore = (pool: Pick<Pool, 'query'>) => ({
  settlementSummary: async (): Promise<readonly SettlementRow[]> => {
    const result = await pool.query<SettlementDbRow>(
      `SELECT network, count(*) FILTER (WHERE status = 'settled') AS settled,
       COALESCE(sum(amount_settled) FILTER (WHERE status = 'settled'), 0) AS settled_atomic,
       max(settled_at) FILTER (WHERE status = 'settled') AS last_settled_at
       FROM x402_payments GROUP BY network`,
    );
    return result.rows.map((row) => ({
      network: row.network,
      settled: Number(row.settled),
      settledAtomic: String(row.settled_atomic),
      lastSettledAt: row.last_settled_at === null ? null : toIsoString(row.last_settled_at),
    }));
  },
  recentSettlements: async (limit: number) => {
    const result = await pool.query<RecentSettlementDbRow>(
      `SELECT network, amount_settled, transaction, settled_at FROM x402_payments
       WHERE status = 'settled' AND transaction IS NOT NULL ORDER BY settled_at DESC LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => ({
      network: row.network,
      amountAtomic: String(row.amount_settled),
      transaction: row.transaction,
      settledAt: toIsoString(row.settled_at),
    }));
  },
  publicCallSummary: async (days: number): Promise<{ calls: number; callers: number; p95LatencyMs: number }> => {
    const result = await pool.query<PublicCallDbRow>(
      `SELECT count(*)::int AS calls, count(DISTINCT ip_hash)::int AS callers,
       COALESCE(percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms)
       FILTER (WHERE outcome = 'ok'), 0)::int AS p95_latency_ms
       FROM public_calls WHERE day >= CURRENT_DATE - $1::int`,
      [days],
    );
    const row = result.rows[0];
    return {
      calls: Number(row?.calls ?? 0),
      callers: Number(row?.callers ?? 0),
      p95LatencyMs: Number(row?.p95_latency_ms ?? 0),
    };
  },
});

export type TelemetryStore = ReturnType<typeof createTelemetryStore>;

export const usdcFromAtomic = (atomic: string): string => {
  const amount = BigInt(atomic);
  const whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${whole}.${fraction.padEnd(2, '0')}`;
};
