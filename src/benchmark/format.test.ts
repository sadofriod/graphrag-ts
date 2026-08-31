import { describe, expect, it } from 'bun:test';

import { formatMarkdownReport } from './format';
import type { PerQueryResult } from './report';
import { aggregateResults } from './report';

const resultOf = (overrides: Partial<PerQueryResult>): PerQueryResult => ({
  query: {
    id: 'v1-q1',
    volume: 1,
    story: 'The Fracture of Perfect Memory',
    fact: 'fact',
    query: 'question',
    topK: 5,
    expectation: { entities: ['Kai'], phrases: ['perfect memory'] },
  },
  evaluation: {
    foundEntities: ['Kai'],
    missingEntities: [],
    foundPhrases: ['perfect memory'],
    missingPhrases: ['deep violet pulse'],
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

    expect(markdown).toContain('# GraphRAG Recall Benchmark');
    expect(markdown).toContain('Total queries: 1');
    expect(markdown).toContain('Strict hits: 0 / 1');
    expect(markdown).toContain('Average entity recall: 100.0%');
    expect(markdown).toContain('| v1-q1 | Volume 1 | The Fracture of Perfect Memory | ❌ | 100% | 50% | - | deep violet pulse |');
  });

  it('lists missing items in the detail row', () => {
    const results = [
      resultOf({
        evaluation: {
          foundEntities: [],
          missingEntities: ['Kai', 'Chen'],
          foundPhrases: [],
          missingPhrases: ['perfect memory'],
          entityRecall: 0,
          phraseRecall: 0,
          combinedRecall: 0,
          hit: false,
        },
      }),
    ];
    const report = aggregateResults(results);
    const markdown = formatMarkdownReport(report, results);

    expect(markdown).toContain('| Kai、Chen | perfect memory |');
  });
});
