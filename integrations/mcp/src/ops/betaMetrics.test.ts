import { describe, expect, test } from 'bun:test';
import { buildBetaReport, formatBetaReportMarkdown, type RetrievalMetricRow } from './betaMetrics.ts';

const retrieval = (overrides: Partial<RetrievalMetricRow> = {}): RetrievalMetricRow => ({
  workspace_id: 'workspace-a',
  week: '2026-01-05T00:00:00.000Z',
  started: 0,
  completed: 0,
  errors: 0,
  durations_ms: [],
  ...overrides,
});

describe('beta metrics', () => {
  test('returns no weeks for empty input', () => {
    expect(buildBetaReport({ retrievals: [], jobs: [], payments: [] })).toEqual({ weeks: [] });
  });

  test('sorts weeks and workspaces and aggregates metrics', () => {
    const report = buildBetaReport({
      retrievals: [
        retrieval({ workspace_id: 'zeta', week: '2026-02-02', started: '3', errors: '1' }),
        retrieval({ workspace_id: 'beta', week: '2026-01-26', started: 2 }),
        retrieval({ workspace_id: 'alpha', week: '2026-02-02', started: 4 }),
      ],
      jobs: [],
      payments: [],
    });
    expect(report.weeks.map(({ week }) => week)).toEqual(['2026-01-26', '2026-02-02']);
    expect(report.weeks[1]?.workspaces.map(({ workspace_id }) => workspace_id)).toEqual(['alpha', 'zeta']);
    expect(report.weeks[1]?.workspaces[1]?.queries).toBe(3);
    expect(report.weeks[1]?.workspaces[1]?.query_errors).toBe(1);
  });

  test('uses nearest-rank percentiles for one through four observations', () => {
    const values = [
      { durations: [8], p50: 8, p95: 8 },
      { durations: [8, 2], p50: 2, p95: 8 },
      { durations: [8, 2, 4], p50: 4, p95: 8 },
      { durations: [8, 2, 4, 6], p50: 4, p95: 8 },
    ];
    for (const sample of values) {
      const workspace = buildBetaReport({
        retrievals: [retrieval({ durations_ms: sample.durations })],
        jobs: [],
        payments: [],
      }).weeks[0]?.workspaces[0];
      expect(workspace?.latency_p50_ms).toBe(sample.p50);
      expect(workspace?.latency_p95_ms).toBe(sample.p95);
    }
  });

  test('uses null for missing latency and zero-job failure rate and rounds failure rate', () => {
    const report = buildBetaReport({
      retrievals: [retrieval()],
      jobs: [
        { workspace_id: 'workspace-a', week: '2026-01-05T00:00:00.000Z', total: '7', failed: '1' },
        { workspace_id: 'workspace-b', week: '2026-01-05T00:00:00.000Z', total: 0, failed: 0 },
      ],
      payments: [],
    });
    expect(report.weeks[0]?.workspaces[0]).toMatchObject({
      latency_p50_ms: null,
      latency_p95_ms: null,
      index_failure_rate: 0.1429,
    });
    expect(report.weeks[0]?.workspaces[1]?.index_failure_rate).toBeNull();
  });

  test('sums settled amounts without floating-point loss', () => {
    const report = buildBetaReport({
      retrievals: [],
      jobs: [],
      payments: [
        { workspace_id: 'workspace-a', week: '2026-01-05', settled: '2', amount_settled: '90071992547409930' },
        { workspace_id: 'workspace-a', week: '2026-01-05', settled: 1, amount_settled: '70' },
      ],
    });
    expect(report.weeks[0]?.workspaces[0]?.settled_atomic).toBe('90071992547410000');
    expect(report.weeks[0]?.workspaces[0]?.paid_queries).toBe(3);
  });

  test('formats a weekly markdown table with its total row and requested columns', () => {
    const report = buildBetaReport({
      retrievals: [retrieval({ started: 2 })],
      jobs: [{ workspace_id: 'workspace-a', week: '2026-01-05T00:00:00.000Z', total: 3, failed: 1 }],
      payments: [{ workspace_id: 'workspace-a', week: '2026-01-05T00:00:00.000Z', settled: 1, amount_settled: '123' }],
    });
    const markdown = formatBetaReportMarkdown(report);
    expect(markdown).toContain('| workspace | queries | query errors | p50 ms | p95 ms | jobs | index failures | failure rate | paid queries | settled (atomic) |');
    expect(markdown).toContain('| **Total** | 2 | 0 | — | — | 3 | 1 | 0.3333 | 1 | 123 |');
  });
});
