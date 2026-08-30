import type { BenchmarkReport, PerQueryResult } from './report';

const percent = (value: number, digits = 1): string => `${(value * 100).toFixed(digits)}%`;

const joinMissing = (items: readonly string[]): string => (items.length === 0 ? '-' : items.join('、'));

/** 把聚合报告渲染为 Markdown，便于在终端直接查看与存档。 */
export const formatMarkdownReport = (
  report: BenchmarkReport,
  results: readonly PerQueryResult[],
): string => {
  const lines: string[] = [];
  lines.push('# GraphRAG 召回率 Benchmark');
  lines.push('');
  lines.push(`- 查询总数: ${report.total}`);
  lines.push(`- 严格命中: ${report.hits} / ${report.total}（${percent(report.strictHitRate)}）`);
  lines.push(`- 平均实体召回率: ${percent(report.avgEntityRecall)}`);
  lines.push(`- 平均信息召回率: ${percent(report.avgPhraseRecall)}`);
  lines.push(`- 平均综合召回率: ${percent(report.avgCombinedRecall)}`);
  lines.push('');
  lines.push('## 分卷统计');
  lines.push('');
  lines.push('| 卷 | 查询数 | 命中 | 命中率 | 实体召回 | 信息召回 |');
  lines.push('|---|:---:|:---:|:---:|:---:|:---:|');
  for (const [volume, summary] of Object.entries(report.byVolume)) {
    const row = [
      `第${volume}卷`,
      String(summary.total),
      String(summary.hits),
      percent(summary.total === 0 ? 0 : summary.hits / summary.total),
      percent(summary.avgEntityRecall),
      percent(summary.avgPhraseRecall),
    ].join(' | ');
    lines.push(`| ${row} |`);
  }
  lines.push('');
  lines.push('## 逐题明细');
  lines.push('');
  lines.push('| id | 卷 | 故事线 | 命中 | 实体召回 | 信息召回 | 缺失实体 | 缺失信息 |');
  lines.push('|---|:---:|---|:---:|:---:|:---:|---|---|');
  for (const { query, evaluation } of results) {
    const row = [
      query.id,
      `第${query.volume}卷`,
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
