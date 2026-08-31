import { describe, expect, it } from 'bun:test';

import { evaluateRecall } from './evaluate';

describe('evaluateRecall', () => {
  it('marks a strict hit when every entity and phrase is present', () => {
    const evaluation = evaluateRecall('Kai Chen metal shard Echo Bazaar', {
      entities: ['Kai', 'Chen'],
      phrases: ['metal shard', 'Echo Bazaar'],
    });
    expect(evaluation.entityRecall).toBe(1);
    expect(evaluation.phraseRecall).toBe(1);
    expect(evaluation.combinedRecall).toBe(1);
    expect(evaluation.hit).toBe(true);
    expect(evaluation.missingEntities).toEqual([]);
    expect(evaluation.missingPhrases).toEqual([]);
  });

  it('reports partial recall when some expectations are missing', () => {
    const evaluation = evaluateRecall('Kai Chen', {
      entities: ['Kai', 'Chen', 'Prometheus'],
      phrases: ['metal shard', 'Midnight Archive'],
    });
    expect(evaluation.entityRecall).toBe(2 / 3);
    expect(evaluation.phraseRecall).toBe(0);
    expect(evaluation.combinedRecall).toBe(2 / 5);
    expect(evaluation.hit).toBe(false);
    expect(evaluation.missingEntities).toEqual(['Prometheus']);
    expect(evaluation.missingPhrases).toEqual(['metal shard', 'Midnight Archive']);
  });

  it('returns zero recall when nothing matches', () => {
    const evaluation = evaluateRecall('irrelevant content', {
      entities: ['Kai'],
      phrases: ['Midnight Archive'],
    });
    expect(evaluation.entityRecall).toBe(0);
    expect(evaluation.phraseRecall).toBe(0);
    expect(evaluation.hit).toBe(false);
  });

  it('treats an empty expectation as fully satisfied', () => {
    const evaluation = evaluateRecall('anything', { entities: [], phrases: [] });
    expect(evaluation.entityRecall).toBe(1);
    expect(evaluation.phraseRecall).toBe(1);
    expect(evaluation.hit).toBe(true);
  });
});
