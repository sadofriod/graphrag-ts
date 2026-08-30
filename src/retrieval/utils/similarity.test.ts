import { describe, expect, it } from 'bun:test';

import { cosineSimilarity, similarity } from './similarity';

describe('similarity', () => {
  it('returns 1 for identical strings', () => {
    expect(similarity('hello world', 'hello world')).toBe(1);
  });

  it('returns 1 for case-insensitive identical strings', () => {
    expect(similarity('Apple', 'apple')).toBe(1);
  });

  it('returns 0 for disjoint token sets', () => {
    expect(similarity('cat', 'dog')).toBe(0);
  });

  it('returns the Jaccard ratio for partial overlap', () => {
    expect(similarity('apple banana', 'apple orange')).toBeCloseTo(1 / 3);
  });

  it('treats two empty strings as identical', () => {
    expect(similarity('', '')).toBe(1);
  });

  it('treats one empty string as disjoint', () => {
    expect(similarity('', 'x')).toBe(0);
  });
});

describe('cosineSimilarity', () => {
  it('returns 1 for identical direction vectors', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it('returns 0 when either vector is zero', () => {
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
    expect(cosineSimilarity([1, 0], [0, 0])).toBe(0);
  });

  it('computes the normalized dot product', () => {
    expect(cosineSimilarity([3, 4], [4, 3])).toBeCloseTo(24 / 25);
  });

  it('throws when vector lengths differ', () => {
    expect(() => cosineSimilarity([1, 0], [1])).toThrow();
  });
});
