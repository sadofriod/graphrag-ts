import { describe, expect, it } from 'bun:test';

import { estimateTokens } from '../../build/detectCommunity/summary/estimateTokens';
import type { GlobalMapAnswer } from '../types/retrieval';
import { parseGlobalReduceOutput, selectGlobalReduceAnswers } from './globalReduce';

describe('selectGlobalReduceAnswers', () => {
  it('ranks positive answers and keeps stable order for ties within budget', () => {
    const answers: GlobalMapAnswer[] = [
      { answer: 'Lower ranked', usefulness: 20, communityIds: ['c1'] },
      { answer: 'Highest ranked', usefulness: 90, communityIds: ['c2'] },
      { answer: 'No signal', usefulness: 0, communityIds: ['c3'] },
    ];
    const selected = selectGlobalReduceAnswers(answers, 'query prompt', 100);

    expect(selected.map((item) => item.answer)).toEqual(['Highest ranked', 'Lower ranked']);
  });

  describe('parseGlobalReduceOutput', () => {
    it('extracts a non-empty answer from structured model output', () => {
      expect(parseGlobalReduceOutput('{"answer":"  Global trend  "}')).toBe('Global trend');
    });

    it('rejects invalid structured output', () => {
      expect(() => parseGlobalReduceOutput('{"answer":""}'))
        .toThrow('Global Reduce output contains an invalid answer.');
      expect(() => parseGlobalReduceOutput('{"result":"answer"}'))
        .toThrow('Global Reduce output must contain an answer field.');
    });
  });

  it('stops at the first answer that exceeds the budget', () => {
    const answers: GlobalMapAnswer[] = [
      { answer: 'First', usefulness: 90, communityIds: ['c1'] },
      { answer: 'x'.repeat(400), usefulness: 80, communityIds: ['c2'] },
      { answer: 'Third', usefulness: 70, communityIds: ['c3'] },
    ];
    const skeleton = 'Question prompt';
    const selected = selectGlobalReduceAnswers(answers, skeleton, 20);

    expect(selected.map((item) => item.answer)).toEqual(['First']);
    expect(estimateTokens(`${skeleton}\n${selected[0]?.answer}`)).toBeLessThanOrEqual(20);
  });
});
