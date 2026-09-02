import { describe, expect, it } from 'bun:test';

import { aggregateResults, formatMarkdownReport } from './report';
import type { PerQueryResult } from './types';

const perQuery = (id: string, source: string, hit: boolean): PerQueryResult => ({
  query: {
    id,
    source,
    focus: 'focus',
    query: 'question',
    topK: 5,
    expectation: { entities: ['Alice'], phrases: ['rabbit-hole'] },
  },
  evaluation: {
    foundEntities: hit ? ['Alice'] : [],
    missingEntities: hit ? [] : ['Alice'],
    foundPhrases: hit ? ['rabbit-hole'] : [],
    missingPhrases: hit ? [] : ['rabbit-hole'],
    entityRecall: hit ? 1 : 0,
    phraseRecall: hit ? 1 : 0,
    combinedRecall: hit ? 1 : 0,
    hit,
  },
});

describe('aggregateResults', () => {
  it('summarizes recall totals by source', () => {
    const report = aggregateResults([
      perQuery('q1', 'Alice', true),
      perQuery('q2', 'Alice', false),
      perQuery('q3', 'Frankenstein', true),
    ]);

    expect(report.total).toBe(3);
    expect(report.hits).toBe(2);
    expect(report.bySource.Alice?.total).toBe(2);
    expect(report.bySource.Frankenstein?.hits).toBe(1);
  });
});

describe('formatMarkdownReport', () => {
  it('renders a markdown recall table', () => {
    const results = [perQuery('q1', 'Alice', false)];
    const markdown = formatMarkdownReport(aggregateResults(results), results);

    expect(markdown).toContain('# GraphRAG Recall Demo');
    expect(markdown).toContain('Average entity recall');
    expect(markdown).toContain('| q1 | Alice | focus | no | 0% | 0% | Alice | rabbit-hole |');
  });
});