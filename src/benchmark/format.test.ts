import { describe, expect, it } from 'bun:test';

import { formatMarkdownReport } from './format';
import type { PerQueryResult } from './report';
import { aggregateResults } from './report';

const resultOf = (overrides: Partial<PerQueryResult>): PerQueryResult => ({
  query: {
    id: 'v1-q1',
    volume: 1,
    story: '完美记忆的裂隙',
    fact: '事实',
    query: '问题',
    topK: 5,
    expectation: { entities: ['凯'], phrases: ['完美记忆'] },
  },
  evaluation: {
    foundEntities: ['凯'],
    missingEntities: [],
    foundPhrases: ['完美记忆'],
    missingPhrases: ['深紫色脉冲'],
    entityRecall: 1,
    phraseRecall: 0.5,
    combinedRecall: 0.5,
    hit: false,
  },
  ...overrides,
});

describe('formatMarkdownReport', () => {
  it('renders totals and per-query rows', () => {
    const results = [resultOf({})];
    const report = aggregateResults(results);
    const markdown = formatMarkdownReport(report, results);

    expect(markdown).toContain('# GraphRAG 召回率 Benchmark');
    expect(markdown).toContain('查询总数: 1');
    expect(markdown).toContain('严格命中: 0 / 1');
    expect(markdown).toContain('平均实体召回率: 100.0%');
    expect(markdown).toContain('| v1-q1 | 第1卷 | 完美记忆的裂隙 | ❌ | 100% | 50% | - | 深紫色脉冲 |');
  });

  it('lists missing items in the detail row', () => {
    const results = [
      resultOf({
        evaluation: {
          foundEntities: [],
          missingEntities: ['凯', '老陈'],
          foundPhrases: [],
          missingPhrases: ['完美记忆'],
          entityRecall: 0,
          phraseRecall: 0,
          combinedRecall: 0,
          hit: false,
        },
      }),
    ];
    const report = aggregateResults(results);
    const markdown = formatMarkdownReport(report, results);

    expect(markdown).toContain('| 凯、老陈 | 完美记忆 |');
  });
});
