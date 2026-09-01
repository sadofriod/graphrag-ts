import type { BenchmarkReport, PerQueryResult } from './report';

const percent = (value: number, digits = 1): string => `${(value * 100).toFixed(digits)}%`;

const joinMissing = (items: readonly string[]): string => (items.length === 0 ? '-' : items.join('、'));

/** Render the aggregated report as Markdown so it can be viewed and archived directly from the terminal. */
export const formatMarkdownReport = (
  report: BenchmarkReport,
  results: readonly PerQueryResult[],
): string => {
  const lines: string[] = [];
  lines.push('# GraphRAG Recall Benchmark');
  lines.push('');
  lines.push(`- Total queries: ${report.total}`);
  lines.push(`- Strict hits: ${report.hits} / ${report.total}（${percent(report.strictHitRate)})`);
  lines.push(`- Average entity recall: ${percent(report.avgEntityRecall)}`);
  lines.push(`- Average phrase recall: ${percent(report.avgPhraseRecall)}`);
  lines.push(`- Average combined recall: ${percent(report.avgCombinedRecall)}`);
  lines.push('');
  lines.push('## Per-volume summary');
  lines.push('');
  lines.push('| Volume | Queries | Hits | Hit rate | Entity recall | Phrase recall |');
  lines.push('|---|:---:|:---:|:---:|:---:|:---:|');
  for (const [volume, summary] of Object.entries(report.byVolume)) {
    const row = [
      `Volume ${volume}`,
      String(summary.total),
      String(summary.hits),
      percent(summary.total === 0 ? 0 : summary.hits / summary.total),
      percent(summary.avgEntityRecall),
      percent(summary.avgPhraseRecall),
    ].join(' | ');
    lines.push(`| ${row} |`);
  }
  lines.push('');
  lines.push('## Per-query details');
  lines.push('');
  lines.push('| id | Volume | Storyline | Hit | Entity recall | Phrase recall | Missing entities | Missing phrases |');
  lines.push('|---|:---:|---|:---:|:---:|:---:|---|---|');
  for (const { query, evaluation } of results) {
    const row = [
      query.id,
      `Volume ${query.volume}`,
      query.story,
      evaluation.hit ? '✅' : '❌',
      percent(evaluation.entityRecall, 0),
      percent(evaluation.phraseRecall, 0),
      joinMissing(evaluation.missingEntities),
      joinMissing(evaluation.missingPhrases),
    ].join(' | ');
    lines.push(`| ${row} |`);
  }
  lines.push('');
  return lines.join('\n');
};
