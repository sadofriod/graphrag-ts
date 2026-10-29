import { Pool } from 'pg';
import { buildBetaReport, formatBetaReportMarkdown, type JobMetricRow, type PaymentMetricRow, type RetrievalMetricRow } from '../src/ops/betaMetrics.ts';
import { isJudgmentDataset, loadDatasetRegistry } from '../src/x402/datasets.ts';

type Args = { days: number; json: boolean; databaseUrl: string | undefined };

const parseArgs = (argv: readonly string[]): Args => {
  let days = 28;
  let json = false;
  let databaseUrl: string | undefined = process.env.DATABASE_URL;
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--json') {
      json = true;
    } else if (flag === '--days' || flag === '--database-url') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
      index++;
      if (flag === '--days') {
        days = Number(value);
        if (!Number.isSafeInteger(days) || days <= 0) throw new Error('--days must be a positive integer.');
      } else {
        databaseUrl = value;
      }
    } else {
      throw new Error(`Unknown argument: ${flag}`);
    }
  }
  return { days, json, databaseUrl };
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  if (!args.databaseUrl) throw new Error('DATABASE_URL is missing; pass --database-url or set DATABASE_URL.');

  const pool = new Pool({ connectionString: args.databaseUrl });
  try {
    const interval = `${args.days} days`;
    const registryPath = process.env.X402_DATASETS_FILE;
    const registry = registryPath === undefined ? undefined : await loadDatasetRegistry(registryPath);
    const workspaceByDataset = new Map(registry?.datasets.filter((dataset) => !isJudgmentDataset(dataset)).map((dataset) => [dataset.id, dataset.workspaceId]));
    const [retrievalResult, jobResult, paymentResult] = await Promise.all([
      pool.query<RetrievalMetricRow>(
        `SELECT workspace_id, date_trunc('week', created_at)::text AS week,
                count(DISTINCT operation_id) FILTER (WHERE message = 'Retrieval started.') AS started,
                count(*) FILTER (WHERE message = 'Retrieval completed.') AS completed,
                count(*) FILTER (WHERE level = 'error') AS errors,
                COALESCE(array_agg((details->>'duration_ms')::numeric) FILTER (
                  WHERE message = 'Retrieval completed.' AND details ? 'duration_ms'
                ), ARRAY[]::numeric[]) AS durations_ms
         FROM workspace_activity_logs
         WHERE kind = 'retrieval' AND created_at >= now() - $1::interval
         GROUP BY workspace_id, date_trunc('week', created_at)`,
        [interval],
      ),
      pool.query<JobMetricRow>(
        `SELECT workspace_id, date_trunc('week', created_at)::text AS week,
                count(*) AS total,
                count(*) FILTER (WHERE status = 'failed') AS failed
         FROM index_jobs
         WHERE created_at >= now() - $1::interval
         GROUP BY workspace_id, date_trunc('week', created_at)`,
        [interval],
      ),
      pool.query<Omit<PaymentMetricRow, 'workspace_id'> & { workspace_id: string | null; dataset_id: string }>(
        `SELECT workspace_id, dataset_id, date_trunc('week', settled_at)::text AS week,
                count(*) AS settled, sum(amount_settled)::text AS amount_settled
         FROM x402_payments
         WHERE status = 'settled' AND settled_at >= now() - $1::interval
         GROUP BY workspace_id, dataset_id, date_trunc('week', settled_at)`,
        [interval],
      ),
    ]);

    const payments: PaymentMetricRow[] = paymentResult.rows.map((row) => {
      const workspaceId = row.workspace_id ?? workspaceByDataset?.get(row.dataset_id);
      if (workspaceId === undefined) {
        throw new Error(`Cannot resolve workspace for legacy payment dataset "${row.dataset_id}"; configure X402_DATASETS_FILE.`);
      }
      return { ...row, workspace_id: workspaceId };
    });
    const report = buildBetaReport({
      retrievals: retrievalResult.rows,
      jobs: jobResult.rows,
      payments,
    });
    console.log(args.json ? JSON.stringify(report, null, 2) : formatBetaReportMarkdown(report));
  } finally {
    await pool.end();
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Beta report failed.');
  process.exitCode = 1;
});
