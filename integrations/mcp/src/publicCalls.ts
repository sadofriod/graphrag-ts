import { createHash } from 'node:crypto';
import type { Pool } from 'pg';

export type PublicCallOutcome = 'ok' | 'error';
export type PublicCallRecord = {
  readonly ipHash: string;
  readonly tool: string;
  readonly outcome: PublicCallOutcome;
  readonly latencyMs: number;
};

/** Daily-rotating pseudonym: sha256(salt:day:ip). Never store or log the raw IP. */
export const hashIp = (ip: string, day: string, salt: string): string =>
  createHash('sha256').update(`${salt}:${day}:${ip}`).digest('hex');

export const createPublicCallStore = (pool: Pick<Pool, 'query'>) => ({
  recordPublicCall: async (record: PublicCallRecord): Promise<void> => {
    await pool.query(
      `INSERT INTO public_calls (day, ip_hash, tool, outcome, latency_ms)
       VALUES (CURRENT_DATE, $1, $2, $3, $4)`,
      [record.ipHash, record.tool, record.outcome, Math.max(0, Math.round(record.latencyMs))],
    );
  },
  prunePublicCalls: async (retentionDays = 90): Promise<void> => {
    await pool.query('DELETE FROM public_calls WHERE day < CURRENT_DATE - $1::int', [retentionDays]);
  },
  publicCallSummary: async (days = 30) => {
    const result = await pool.query<{ day: string; tool: string; calls: number; callers: number }>(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, tool,
              count(*)::int AS calls, count(DISTINCT ip_hash)::int AS callers
       FROM public_calls
       WHERE day >= CURRENT_DATE - $1::int
       GROUP BY 1, 2
       ORDER BY 1 DESC, 4 DESC`,
      [days],
    );
    return result.rows;
  },
});
