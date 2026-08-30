import { describe, expect, it } from 'bun:test';

import { estimateTokens } from './estimateTokens';

describe('estimateTokens', () => {
  it('returns 0 for empty text', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('counts ascii text at 4 chars per token', () => {
    // 11 ascii chars -> ceil(11/4) = 3
    expect(estimateTokens('hello world')).toBe(3);
  });

  it('counts cjk text at 1.8 chars per token', () => {
    // 4 cjk chars -> ceil(4/1.8) = 3
    expect(estimateTokens('中文测试')).toBe(3);
  });

  it('mixes ascii and cjk', () => {
    // 1 ascii + 2 cjk -> ceil(0.25 + 1.111) = 2
    expect(estimateTokens('A中文')).toBe(2);
  });
});
