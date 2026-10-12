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

  it('renders Global Map Reduce and incremental update benchmark results', () => {
    const queryResult = perQuery('updated-fact', 'Alice', true);
    const markdown = formatMarkdownReport(aggregateResults([]), [], {
      globalMapReduce: [{
        query: queryResult.query,
        mapEvaluation: queryResult.evaluation,
        evaluation: queryResult.evaluation,
        status: 'completed',
        mapAnswerCount: 3,
        failedMapBatches: 0,
      }],
      incrementalUpdate: {
        durationMs: 1250,
        updatedFile: 'alice.md',
        result: queryResult,
      },
    });

    expect(markdown).toContain('## Global Map Reduce');
    expect(markdown).toContain('Map entity recall | Map phrase recall');
    expect(markdown).toContain('| updated-fact | completed | 3 | 0 | 100% | 100% | 100% | 100% | - | - |');
    expect(markdown).toContain('## Incremental Update');
    expect(markdown).toContain('- Updated file: alice.md');
    expect(markdown).toContain('- Build mode: incremental');
    expect(markdown).toContain('| updated-fact | yes | 100% | 100% | - | - |');
  });
});