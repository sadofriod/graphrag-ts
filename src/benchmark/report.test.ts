import { describe, expect, it } from 'bun:test';

import type { BenchmarkQuery } from './dataset';
import type { QueryEvaluation } from './evaluate';
import type { PerQueryResult } from './report';
import { aggregateResults } from './report';

const queryOf = (id: string, volume: 1 | 2 | 3): BenchmarkQuery => ({
  id,
  volume,
  story: 'storyline',
  fact: 'fact',
  query: `q-${id}`,
  topK: 5,
  expectation: { entities: ['A'], phrases: ['P'] },
});

const evaluationOf = (hit: boolean, entityRecall: number, phraseRecall: number): QueryEvaluation => ({
  foundEntities: hit ? ['A'] : [],
  missingEntities: hit ? [] : ['A'],
  foundPhrases: hit ? ['P'] : [],
  missingPhrases: hit ? [] : ['P'],
  entityRecall,
  phraseRecall,
  combinedRecall: hit ? 1 : 0,
  hit,
});

const resultOf = (id: string, volume: 1 | 2 | 3, evaluation: QueryEvaluation): PerQueryResult => ({
  query: queryOf(id, volume),
  evaluation,
});

describe('aggregateResults', () => {
  it('returns zeroed summary for empty input', () => {
    const report = aggregateResults([]);
    expect(report.total).toBe(0);
    expect(report.hits).toBe(0);
    expect(report.strictHitRate).toBe(0);
    expect(report.avgEntityRecall).toBe(0);
    expect(report.byVolume).toEqual({});
  });

  it('aggregates hits and averages across queries', () => {
    const results = [
      resultOf('v1-q1', 1, evaluationOf(true, 1, 1)),
      resultOf('v1-q2', 1, evaluationOf(false, 0.5, 0)),
      resultOf('v2-q1', 2, evaluationOf(true, 1, 1)),
    ];
    const report = aggregateResults(results);

    expect(report.total).toBe(3);
    expect(report.hits).toBe(2);
    expect(report.strictHitRate).toBeCloseTo(2 / 3);
    expect(report.avgEntityRecall).toBeCloseTo((1 + 0.5 + 1) / 3);
    expect(report.avgPhraseRecall).toBeCloseTo((1 + 0 + 1) / 3);
    expect(report.avgCombinedRecall).toBeCloseTo((1 + 0 + 1) / 3);
  });

  it('groups summaries by volume', () => {
    const report = aggregateResults([
      resultOf('v1-q1', 1, evaluationOf(true, 1, 1)),
      resultOf('v1-q2', 1, evaluationOf(false, 0, 0)),
      resultOf('v3-q1', 3, evaluationOf(true, 1, 1)),
    ]);

    expect(report.byVolume['1']).toEqual({
      total: 2,
      hits: 1,
      avgEntityRecall: 0.5,
      avgPhraseRecall: 0.5,
      avgCombinedRecall: 0.5,
    });
    expect(report.byVolume['3']).toEqual({
      total: 1,
      hits: 1,
      avgEntityRecall: 1,
      avgPhraseRecall: 1,
      avgCombinedRecall: 1,
    });
    expect(report.byVolume['2']).toBeUndefined();
  });
});
