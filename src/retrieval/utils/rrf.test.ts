import { describe, expect, it } from 'bun:test';

import { reciprocalRankFusion } from './rrf';

interface NamedItem {
  id: string;
}

const getId = (item: NamedItem): string => item.id;

describe('reciprocalRankFusion', () => {
  it('returns an empty list for empty input', () => {
    expect(reciprocalRankFusion([], getId)).toEqual([]);
  });

  it('keeps a single ranked list in order', () => {
    const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const result = reciprocalRankFusion([list], getId);

    expect(result.map(({ item }) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('boosts items appearing in multiple lists with k=60 default', () => {
    const left = [{ id: 'a' }, { id: 'b' }];
    const right = [{ id: 'b' }, { id: 'c' }];
    const result = reciprocalRankFusion([left, right], getId);

    expect(result.map(({ item }) => item.id)).toEqual(['b', 'a', 'c']);
    expect(result[0]?.score).toBeCloseTo(1 / 61 + 1 / 62);
    expect(result[1]?.score).toBeCloseTo(1 / 61);
    expect(result[2]?.score).toBeCloseTo(1 / 62);
  });

  it('fuses with a custom k', () => {
    const left = [{ id: 'a' }, { id: 'b' }];
    const right = [{ id: 'b' }, { id: 'c' }];
    const result = reciprocalRankFusion([left, right], getId, 1);

    expect(result.map(({ item }) => item.id)).toEqual(['b', 'a', 'c']);
    expect(result[0]?.score).toBeCloseTo(1 / 2 + 1 / 3);
  });

  it('deduplicates identical ids across lists into a single entry', () => {
    const list = [{ id: 'x' }];
    const result = reciprocalRankFusion([list, list], getId);

    expect(result).toHaveLength(1);
    expect(result[0]?.score).toBeCloseTo(2 / 61);
  });
});
