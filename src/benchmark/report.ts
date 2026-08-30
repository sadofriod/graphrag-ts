import type { BenchmarkQuery } from './dataset';
import type { QueryEvaluation } from './evaluate';

/** 单条查询的评估结果（含原始查询定义，便于输出明细表）。 */
export interface PerQueryResult {
  query: BenchmarkQuery;
  evaluation: QueryEvaluation;
}

export interface VolumeSummary {
  total: number;
  hits: number;
  avgEntityRecall: number;
  avgPhraseRecall: number;
  avgCombinedRecall: number;
}

export interface BenchmarkReport {
  total: number;
  hits: number;
  strictHitRate: number;
  avgEntityRecall: number;
  avgPhraseRecall: number;
  avgCombinedRecall: number;
  byVolume: Record<string, VolumeSummary>;
}

const average = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

const toVolumeSummary = (items: readonly PerQueryResult[]): VolumeSummary => ({
  total: items.length,
  hits: items.filter(({ evaluation }) => evaluation.hit).length,
  avgEntityRecall: average(items.map(({ evaluation }) => evaluation.entityRecall)),
  avgPhraseRecall: average(items.map(({ evaluation }) => evaluation.phraseRecall)),
  avgCombinedRecall: average(items.map(({ evaluation }) => evaluation.combinedRecall)),
});

export const aggregateResults = (results: readonly PerQueryResult[]): BenchmarkReport => {
  const byVolume = new Map<number, PerQueryResult[]>();
  for (const result of results) {
    const list = byVolume.get(result.query.volume) ?? [];
    list.push(result);
    byVolume.set(result.query.volume, list);
  }

  const grouped: Record<string, VolumeSummary> = {};
  for (const [volume, items] of byVolume) {
    grouped[String(volume)] = toVolumeSummary(items);
  }

  const total = results.length;
  const hits = results.filter(({ evaluation }) => evaluation.hit).length;

  return {
    total,
    hits,
    strictHitRate: total === 0 ? 0 : hits / total,
    avgEntityRecall: average(results.map(({ evaluation }) => evaluation.entityRecall)),
    avgPhraseRecall: average(results.map(({ evaluation }) => evaluation.phraseRecall)),
    avgCombinedRecall: average(results.map(({ evaluation }) => evaluation.combinedRecall)),
    byVolume: grouped,
  };
};
