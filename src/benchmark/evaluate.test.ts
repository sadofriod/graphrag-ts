import { describe, expect, it } from 'bun:test';

import { evaluateRecall } from './evaluate';

describe('evaluateRecall', () => {
  it('marks a strict hit when every entity and phrase is present', () => {
    const evaluation = evaluateRecall('凯 老陈 金属碎片 回声集市', {
      entities: ['凯', '老陈'],
      phrases: ['金属碎片', '回声集市'],
    });
    expect(evaluation.entityRecall).toBe(1);
    expect(evaluation.phraseRecall).toBe(1);
    expect(evaluation.combinedRecall).toBe(1);
    expect(evaluation.hit).toBe(true);
    expect(evaluation.missingEntities).toEqual([]);
    expect(evaluation.missingPhrases).toEqual([]);
  });

  it('reports partial recall when some expectations are missing', () => {
    const evaluation = evaluateRecall('凯 老陈', {
      entities: ['凯', '老陈', '普罗米修斯'],
      phrases: ['金属碎片', '零点档案'],
    });
    expect(evaluation.entityRecall).toBe(2 / 3);
    expect(evaluation.phraseRecall).toBe(0);
    expect(evaluation.combinedRecall).toBe(2 / 5);
    expect(evaluation.hit).toBe(false);
    expect(evaluation.missingEntities).toEqual(['普罗米修斯']);
    expect(evaluation.missingPhrases).toEqual(['金属碎片', '零点档案']);
  });

  it('returns zero recall when nothing matches', () => {
    const evaluation = evaluateRecall('无关内容', {
      entities: ['凯'],
      phrases: ['零点档案'],
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
