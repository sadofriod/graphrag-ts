import type { Pool } from 'pg';
import type { MeteredOperation } from './access.ts';

export type UsageRecord = {
  readonly operation: MeteredOperation;
  readonly units: number;
};

export const createUsageStore = (pool: Pick<Pool, 'query'>) => ({
  consumeUsage: async (accountId: string, operation: MeteredOperation, limit: number): Promise<boolean> => {
    if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('Usage limits must be non-negative safe integers.');
    if (limit === 0) return false;
    const result = await pool.query(
      `INSERT INTO mcp_usage (account_id, period, operation, units)
       VALUES ($1, date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, $2, 1)
       ON CONFLICT (account_id, period, operation)
       DO UPDATE SET units = mcp_usage.units + 1
       WHERE mcp_usage.units < $3
       RETURNING units`,
      [accountId, operation, limit],
    );
    return result.rows.length === 1;
  },
  getUsage: async (accountId: string): Promise<{ period: string; usage: UsageRecord[] }> => {
    const result = await pool.query<{ period: string; operation: MeteredOperation | null; units: number | null }>(
      `SELECT to_char(p.period, 'YYYY-MM') AS period, u.operation, u.units
       FROM (SELECT date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date AS period) p
       LEFT JOIN mcp_usage u ON u.period = p.period AND u.account_id = $1
       ORDER BY u.operation`,
      [accountId],
    );
    const period = result.rows[0]?.period;
    if (!period) throw new Error('Usage query did not return the billing period.');
    return {
      period,
      usage: result.rows.flatMap((row) =>
        row.operation === null || row.units === null ? [] : [{ operation: row.operation, units: row.units }],
      ),
    };
  },
});

export type UsageStore = ReturnType<typeof createUsageStore>;
