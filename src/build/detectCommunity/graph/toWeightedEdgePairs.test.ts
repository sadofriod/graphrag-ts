import { describe, expect, it } from 'bun:test';

import { toWeightedEdgePairs } from './toWeightedEdgePairs';

describe('toWeightedEdgePairs', () => {
  it('maps each unique vertex to an index in first-appearance order', () => {
    const pairs = toWeightedEdgePairs([
      { source: 'A', target: 'B' },
      { source: 'B', target: 'C' },
    ]);

    expect(Array.from(pairs)).toEqual([0, 1, 1, 2]);
  });

  it('repeats an edge by its rounded weight to emulate weighted edges', () => {
    const pairs = toWeightedEdgePairs([{ source: 'A', target: 'B', weight: 3 }]);

    expect(Array.from(pairs)).toEqual([0, 1, 0, 1, 0, 1]);
  });

  it('normalizes missing, non-finite and sub-1 weights to a single edge', () => {
    const pairs = toWeightedEdgePairs([
      { source: 'A', target: 'B' },
      { source: 'B', target: 'C', weight: Number.NaN },
      { source: 'C', target: 'D', weight: 0 },
    ]);

    expect(Array.from(pairs)).toEqual([0, 1, 1, 2, 2, 3]);
  });
});
