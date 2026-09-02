import type { PerQueryResult, RecallReport, SourceSummary } from './types';

const average = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

const percent = (value: number, digits = 1): string => `${(value * 100).toFixed(digits)}%`;

const joinMissing = (items: readonly string[]): string => (items.length === 0 ? '-' : items.join(', '));

const toSourceSummary = (items: readonly PerQueryResult[]): SourceSummary => ({
  total: items.length,
  hits: items.filter(({ evaluation }) => evaluation.hit).length,
  avgEntityRecall: average(items.map(({ evaluation }) => evaluation.entityRecall)),
  avgPhraseRecall: average(items.map(({ evaluation }) => evaluation.phraseRecall)),
  avgCombinedRecall: average(items.map(({ evaluation }) => evaluation.combinedRecall)),
});

export const aggregateResults = (results: readonly PerQueryResult[]): RecallReport => {
  const grouped = new Map<string, PerQueryResult[]>();
  for (const result of results) {
    grouped.set(result.query.source, [...(grouped.get(result.query.source) ?? []), result]);
  }

  const bySource = Object.fromEntries(
    [...grouped.entries()].map(([source, items]) => [source, toSourceSummary(items)]),
  );
  const total = results.length;
  const hits = results.filter(({ evaluation }) => evaluation.hit).length;

  return {
    total,
    hits,
    strictHitRate: total === 0 ? 0 : hits / total,
    avgEntityRecall: average(results.map(({ evaluation }) => evaluation.entityRecall)),
    avgPhraseRecall: average(results.map(({ evaluation }) => evaluation.phraseRecall)),
    avgCombinedRecall: average(results.map(({ evaluation }) => evaluation.combinedRecall)),
    bySource,
  };
};

export const formatMarkdownReport = (
  report: RecallReport,
  results: readonly PerQueryResult[],
): string => {
  const lines: string[] = [];
  lines.push('# GraphRAG Recall Demo');
  lines.push('');
  lines.push(`- Total queries: ${report.total}`);
  lines.push(`- Strict hits: ${report.hits} / ${report.total} (${percent(report.strictHitRate)})`);
  lines.push(`- Average entity recall: ${percent(report.avgEntityRecall)}`);
  lines.push(`- Average phrase recall: ${percent(report.avgPhraseRecall)}`);
  lines.push(`- Average combined recall: ${percent(report.avgCombinedRecall)}`);
  lines.push('');
  lines.push('## Per-source summary');
  lines.push('');
  lines.push('| Source | Queries | Hits | Hit rate | Entity recall | Phrase recall |');
  lines.push('|---|:---:|:---:|:---:|:---:|:---:|');
  for (const [source, summary] of Object.entries(report.bySource)) {
    lines.push(`| ${source} | ${summary.total} | ${summary.hits} | ${percent(summary.total === 0 ? 0 : summary.hits / summary.total)} | ${percent(summary.avgEntityRecall)} | ${percent(summary.avgPhraseRecall)} |`);
  }
  lines.push('');
  lines.push('## Per-query details');
  lines.push('');
  lines.push('| id | Source | Focus | Hit | Entity recall | Phrase recall | Missing entities | Missing phrases |');
  lines.push('|---|---|---|:---:|:---:|:---:|---|---|');
  for (const { query, evaluation } of results) {
    lines.push(`| ${query.id} | ${query.source} | ${query.focus} | ${evaluation.hit ? 'yes' : 'no'} | ${percent(evaluation.entityRecall, 0)} | ${percent(evaluation.phraseRecall, 0)} | ${joinMissing(evaluation.missingEntities)} | ${joinMissing(evaluation.missingPhrases)} |`);
  }
  lines.push('');
  return lines.join('\n');
};