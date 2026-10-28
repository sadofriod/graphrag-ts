export type RetrievalMetricRow = {
  workspace_id: string;
  week: string;
  started: number | string;
  completed: number | string;
  errors: number | string;
  durations_ms: readonly (number | string | null)[];
};

export type JobMetricRow = {
  workspace_id: string;
  week: string;
  total: number | string;
  failed: number | string;
};

export type PaymentMetricRow = {
  workspace_id: string;
  week: string;
  settled: number | string;
  amount_settled: string | null;
};

export type BetaWorkspaceMetrics = {
  workspace_id: string;
  queries: number;
  query_errors: number;
  latency_p50_ms: number | null;
  latency_p95_ms: number | null;
  jobs: number;
  index_failures: number;
  index_failure_rate: number | null;
  paid_queries: number;
  settled_atomic: string;
};

export type BetaReport = {
  weeks: readonly {
    week: string;
    workspaces: readonly BetaWorkspaceMetrics[];
  }[];
};

type MutableWorkspaceMetrics = {
  workspace_id: string;
  queries: number;
  query_errors: number;
  durations: number[];
  jobs: number;
  index_failures: number;
  paid_queries: number;
  settled_atomic: bigint;
};

const getWorkspace = (
  weeks: Map<string, Map<string, MutableWorkspaceMetrics>>,
  week: string,
  workspaceId: string,
): MutableWorkspaceMetrics => {
  let workspaceMap = weeks.get(week);
  if (workspaceMap === undefined) {
    workspaceMap = new Map();
    weeks.set(week, workspaceMap);
  }

  let workspace = workspaceMap.get(workspaceId);
  if (workspace === undefined) {
    workspace = {
      workspace_id: workspaceId,
      queries: 0,
      query_errors: 0,
      durations: [],
      jobs: 0,
      index_failures: 0,
      paid_queries: 0,
      settled_atomic: 0n,
    };
    workspaceMap.set(workspaceId, workspace);
  }
  return workspace;
};

const numericValue = (value: number | string): number => Number(value);

const percentile = (values: readonly number[], quantile: number): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil(quantile * sorted.length);
  return sorted[rank - 1] ?? null;
};

export const buildBetaReport = (input: {
  retrievals: readonly RetrievalMetricRow[];
  jobs: readonly JobMetricRow[];
  payments: readonly PaymentMetricRow[];
}): BetaReport => {
  const weeks = new Map<string, Map<string, MutableWorkspaceMetrics>>();

  for (const row of input.retrievals) {
    const workspace = getWorkspace(weeks, row.week, row.workspace_id);
    workspace.queries += numericValue(row.started);
    workspace.query_errors += numericValue(row.errors);
    workspace.durations.push(...row.durations_ms
      .filter((duration): duration is number | string => duration !== null)
      .map((duration) => numericValue(duration)));
  }

  for (const row of input.jobs) {
    const workspace = getWorkspace(weeks, row.week, row.workspace_id);
    workspace.jobs += numericValue(row.total);
    workspace.index_failures += numericValue(row.failed);
  }

  for (const row of input.payments) {
    const workspace = getWorkspace(weeks, row.week, row.workspace_id);
    workspace.paid_queries += numericValue(row.settled);
    workspace.settled_atomic += BigInt(row.amount_settled ?? '0');
  }

  return {
    weeks: [...weeks.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([week, workspaceMap]) => ({
        week,
        workspaces: [...workspaceMap.values()]
          .sort((left, right) => left.workspace_id.localeCompare(right.workspace_id))
          .map((workspace) => ({
            workspace_id: workspace.workspace_id,
            queries: workspace.queries,
            query_errors: workspace.query_errors,
            latency_p50_ms: percentile(workspace.durations, 0.5),
            latency_p95_ms: percentile(workspace.durations, 0.95),
            jobs: workspace.jobs,
            index_failures: workspace.index_failures,
            index_failure_rate: workspace.jobs === 0
              ? null
              : Math.round((workspace.index_failures / workspace.jobs) * 10_000) / 10_000,
            paid_queries: workspace.paid_queries,
            settled_atomic: workspace.settled_atomic.toString(),
          })),
      })),
  };
};

const display = (value: number | null): string => value === null ? '—' : String(value);

export const formatBetaReportMarkdown = (report: BetaReport): string => {
  const sections: string[] = [];
  for (const week of report.weeks) {
    const rows = [
      `## ${week.week}`,
      '',
      '| workspace | queries | query errors | p50 ms | p95 ms | jobs | index failures | failure rate | paid queries | settled (atomic) |',
      '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
      ...week.workspaces.map((workspace) =>
        `| ${workspace.workspace_id} | ${workspace.queries} | ${workspace.query_errors} | ${display(workspace.latency_p50_ms)} | ${display(workspace.latency_p95_ms)} | ${workspace.jobs} | ${workspace.index_failures} | ${display(workspace.index_failure_rate)} | ${workspace.paid_queries} | ${workspace.settled_atomic} |`,
      ),
    ];
    const totals = week.workspaces.reduce((sum, workspace) => ({
      queries: sum.queries + workspace.queries,
      queryErrors: sum.queryErrors + workspace.query_errors,
      jobs: sum.jobs + workspace.jobs,
      indexFailures: sum.indexFailures + workspace.index_failures,
      paidQueries: sum.paidQueries + workspace.paid_queries,
      settledAtomic: sum.settledAtomic + BigInt(workspace.settled_atomic),
    }), {
      queries: 0,
      queryErrors: 0,
      jobs: 0,
      indexFailures: 0,
      paidQueries: 0,
      settledAtomic: 0n,
    });
    const totalFailureRate = totals.jobs === 0
      ? null
      : Math.round((totals.indexFailures / totals.jobs) * 10_000) / 10_000;
    rows.push(`| **Total** | ${totals.queries} | ${totals.queryErrors} | — | — | ${totals.jobs} | ${totals.indexFailures} | ${display(totalFailureRate)} | ${totals.paidQueries} | ${totals.settledAtomic.toString()} |`);
    sections.push(rows.join('\n'));
  }
  return sections.join('\n\n');
};
