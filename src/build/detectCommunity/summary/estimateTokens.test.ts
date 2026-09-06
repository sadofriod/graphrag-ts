import { describe, expect, it } from 'bun:test';

import { estimateTokens } from './estimateTokens';

describe('estimateTokens', () => {
  it('returns 0 for empty text', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('counts ascii text at 4 chars per token', () => {
    expect(estimateTokens('hello world')).toBe(3);
  });

  it('counts cjk text at 1.8 chars per token', () => {
    expect(estimateTokens('Chinese test')).toBe(3);
  });

  it('mixes ascii and cjk', () => {
    expect(estimateTokens('AChinese')).toBe(2);
  });
});
