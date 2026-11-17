import type { Pool } from 'pg';

export type SettlementRow = {
  readonly network: string;
  readonly settled: number;
  readonly settledAtomic: string;
  readonly lastSettledAt: string | null;
};

export type DatasetSettlementRow = {
  readonly datasetId: string;
  readonly network: string;
  readonly settled: number;
  readonly settledAtomic: string;
  readonly lastSettledAt: string | null;
};

export type NetworkPayerSettlementRow = {
  readonly network: string;
  readonly payer: string | null;
  readonly settled: number;
  readonly settledAtomic: string;
};

export type DatasetPayerSettlementRow = NetworkPayerSettlementRow & {
  readonly datasetId: string;
  readonly lastSettledAt: string | null;
};

export type ToolCallRow = { readonly tool: string; readonly calls: number };
export type GraphCorpusRow = {
  readonly workspaceId: string;
  readonly entities: number;
  readonly relationships: number;
  readonly publishedAt: string | null;
};

type SettlementDbRow = {
  readonly network: string;
  readonly settled: number | string;
  readonly settled_atomic: string;
  readonly last_settled_at: Date | string | null;
};

type RecentSettlementDbRow = {
  readonly dataset_id: string;
  readonly network: string;
  readonly amount_settled: string;
  readonly transaction: string;
  readonly settled_at: Date | string;
  readonly payer: string | null;
};

type NetworkPayerDbRow = {
  readonly network: string;
  readonly payer: string | null;
  readonly settled: number | string;
  readonly settled_atomic: string;
};

type DatasetPayerDbRow = NetworkPayerDbRow & {
  readonly dataset_id: string;
  readonly last_settled_at: Date | string | null;
};

type DatasetSettlementDbRow = {
  readonly dataset_id: string;
  readonly network: string;
  readonly settled: number | string;
  readonly settled_atomic: string;
  readonly last_settled_at: Date | string | null;
};

type ToolCallDbRow = { readonly tool: string; readonly calls: number | string };
type RejectedAttemptDbRow = { readonly attempts: number | string };
type GraphCorpusDbRow = {
  readonly workspace_id: string;
  readonly entities: number | string;
  readonly relationships: number | string;
  readonly published_at: Date | string | null;
};

type PublicCallDbRow = {
  readonly calls: number | string;
  readonly callers: number | string;
  readonly p95_latency_ms: number | string;
};

const toIsoString = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const settlementSummary = async (pool: Pick<Pool, 'query'>): Promise<readonly SettlementRow[]> => {
  const result = await pool.query<SettlementDbRow>(
      `SELECT network, count(*) FILTER (WHERE status = 'settled') AS settled,
       COALESCE(sum(amount_settled) FILTER (WHERE status = 'settled'), 0) AS settled_atomic,
       max(settled_at) FILTER (WHERE status = 'settled') AS last_settled_at
       FROM x402_payments GROUP BY network`,
  );
  return result.rows.map((row) => ({
    network: row.network, settled: Number(row.settled), settledAtomic: String(row.settled_atomic),
    lastSettledAt: row.last_settled_at === null ? null : toIsoString(row.last_settled_at),
  }));
};

const recentSettlements = async (pool: Pick<Pool, 'query'>, limit: number) => {
  const result = await pool.query<RecentSettlementDbRow>(
      `SELECT dataset_id, network, amount_settled, transaction, settled_at, lower(payer) AS payer FROM x402_payments
       WHERE status = 'settled' AND transaction IS NOT NULL ORDER BY settled_at DESC LIMIT $1`,
      [limit],
  );
  return result.rows.map((row) => ({
    datasetId: row.dataset_id, network: row.network, amountAtomic: String(row.amount_settled),
    transaction: row.transaction, settledAt: toIsoString(row.settled_at), payer: row.payer,
  }));
};

const settlementByDataset = async (pool: Pick<Pool, 'query'>): Promise<readonly DatasetSettlementRow[]> => {
  const result = await pool.query<DatasetSettlementDbRow>(
      `SELECT dataset_id, network, count(*) FILTER (WHERE status = 'settled') AS settled,
       COALESCE(sum(amount_settled) FILTER (WHERE status = 'settled'), 0) AS settled_atomic,
       max(settled_at) FILTER (WHERE status = 'settled') AS last_settled_at
       FROM x402_payments GROUP BY dataset_id, network`,
  );
  return result.rows.map((row) => ({
    datasetId: row.dataset_id, network: row.network, settled: Number(row.settled),
    settledAtomic: String(row.settled_atomic),
    lastSettledAt: row.last_settled_at === null ? null : toIsoString(row.last_settled_at),
  }));
};

const settlementByNetworkPayer = async (pool: Pick<Pool, 'query'>): Promise<readonly NetworkPayerSettlementRow[]> => {
  const result = await pool.query<NetworkPayerDbRow>(
    `SELECT network, lower(payer) AS payer, count(*) FILTER (WHERE status='settled') AS settled,
     COALESCE(sum(amount_settled) FILTER (WHERE status='settled'),0) AS settled_atomic
     FROM x402_payments GROUP BY network, lower(payer)`,
  );
  return result.rows.map((row) => ({
    network: row.network, payer: row.payer, settled: Number(row.settled), settledAtomic: String(row.settled_atomic),
  }));
};

const settlementByDatasetPayer = async (pool: Pick<Pool, 'query'>): Promise<readonly DatasetPayerSettlementRow[]> => {
  const result = await pool.query<DatasetPayerDbRow>(
    `SELECT dataset_id, network, lower(payer) AS payer, count(*) FILTER (WHERE status='settled') AS settled,
     COALESCE(sum(amount_settled) FILTER (WHERE status='settled'),0) AS settled_atomic,
     max(settled_at) FILTER (WHERE status='settled') AS last_settled_at
     FROM x402_payments GROUP BY dataset_id, network, lower(payer)`,
  );
  return result.rows.map((row) => ({
    datasetId: row.dataset_id, network: row.network, payer: row.payer, settled: Number(row.settled),
    settledAtomic: String(row.settled_atomic),
    lastSettledAt: row.last_settled_at === null ? null : toIsoString(row.last_settled_at),
  }));
};

const publicCallSummary = async (pool: Pick<Pool, 'query'>, days: number) => {
  const result = await pool.query<PublicCallDbRow>(
      `SELECT count(*)::int AS calls, count(DISTINCT ip_hash)::int AS callers,
       COALESCE(percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms)
       FILTER (WHERE outcome = 'ok'), 0)::int AS p95_latency_ms
       FROM public_calls WHERE day >= CURRENT_DATE - $1::int`,
      [days],
  );
  const row = result.rows[0];
  return {
    calls: Number(row?.calls ?? 0), callers: Number(row?.callers ?? 0),
    p95LatencyMs: Number(row?.p95_latency_ms ?? 0),
  };
};

const publicCallsByTool = async (pool: Pick<Pool, 'query'>, days: number): Promise<readonly ToolCallRow[]> => {
  const result = await pool.query<ToolCallDbRow>(
      `SELECT tool, count(*)::int AS calls FROM public_calls
       WHERE day >= CURRENT_DATE - $1::int GROUP BY tool ORDER BY calls DESC, tool ASC`,
      [days],
  );
  return result.rows.map((row) => ({ tool: row.tool, calls: Number(row.calls) }));
};

const rejectedAttempts = async (pool: Pick<Pool, 'query'>, days: number): Promise<number> => {
  const result = await pool.query<RejectedAttemptDbRow>(
      `SELECT count(*)::int AS attempts FROM x402_rejected_attempts
       WHERE received_at >= now() - ($1::int * interval '1 day')`,
      [days],
  );
  return Number(result.rows[0]?.attempts ?? 0);
};

const activeGraphCorpus = async (pool: Pick<Pool, 'query'>): Promise<readonly GraphCorpusRow[]> => {
  const result = await pool.query<GraphCorpusDbRow>(
      `SELECT ai.workspace_id,
       (SELECT count(*)::int FROM rag_entities re WHERE re.namespace = iv.namespace) AS entities,
       (SELECT count(*)::int FROM rag_graph_edges rge WHERE rge.namespace = iv.namespace) AS relationships,
       iv.published_at
       FROM active_index ai JOIN index_versions iv ON iv.id = ai.version_id`,
  );
  return result.rows.map((row) => ({
    workspaceId: row.workspace_id, entities: Number(row.entities), relationships: Number(row.relationships),
    publishedAt: row.published_at === null ? null : toIsoString(row.published_at),
  }));
};

export const createTelemetryStore = (pool: Pick<Pool, 'query'>) => ({
  settlementSummary: () => settlementSummary(pool),
  recentSettlements: (limit: number) => recentSettlements(pool, limit),
  settlementByDataset: () => settlementByDataset(pool),
  settlementByNetworkPayer: () => settlementByNetworkPayer(pool),
  settlementByDatasetPayer: () => settlementByDatasetPayer(pool),
  publicCallSummary: (days: number) => publicCallSummary(pool, days),
  publicCallsByTool: (days: number) => publicCallsByTool(pool, days),
  rejectedAttempts: (days: number) => rejectedAttempts(pool, days),
  activeGraphCorpus: () => activeGraphCorpus(pool),
});

export type TelemetryStore = ReturnType<typeof createTelemetryStore>;

export const usdcFromAtomic = (atomic: string): string => {
  const amount = BigInt(atomic);
  const whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${whole}.${fraction.padEnd(2, '0')}`;
};
