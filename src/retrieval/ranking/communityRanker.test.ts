import { describe, expect, it } from 'bun:test';

import type { WeightedGraphEdge } from '../../build/detectCommunity';
import type { CommunityRecord } from '../types/graph';
import {
  computeEntityOverlap,
  computeStructuralScore,
  rankCommunities,
  rankCommunitiesWithRRF,
} from './communityRanker';

const communities: CommunityRecord[] = [
  { id: 'c1', members: ['A', 'B'], summary: 's1' },
  { id: 'c2', members: ['C', 'D'], summary: 's2' },
];

const edges: WeightedGraphEdge[] = [
  { source: 'A', target: 'B', weight: 2 },
  { source: 'A', target: 'C', weight: 5 },
];

const pairEdges: WeightedGraphEdge[] = [{ source: 'A', target: 'B', weight: 2 }];

describe('computeEntityOverlap', () => {
  it('computes the Jaccard overlap between query and community entities', () => {
    expect(computeEntityOverlap(['A', 'B'], ['A', 'C'])).toBeCloseTo(1 / 3);
    expect(computeEntityOverlap(['A'], ['A', 'B'])).toBeCloseTo(0.5);
    expect(computeEntityOverlap(['A'], ['C'])).toBe(0);
  });
});

describe('computeStructuralScore', () => {
  it('sums edge weights between query and community entities', () => {
    expect(computeStructuralScore(['A'], ['A', 'B'], edges)).toBe(2);
    expect(computeStructuralScore(['A'], ['C', 'D'], edges)).toBe(5);
  });
});

describe('rankCommunitiesWithRRF', () => {
  it('fuses the three heterogeneous rankings with RRF', () => {
    const result = rankCommunitiesWithRRF(
      ['c2', 'c1'], // semantic
      ['c1', 'c2'], // entity overlap
      ['c2', 'c1'], // structural
      communities,
      ['A'],
    );

    expect(result.map((community) => community.id)).toEqual(['c2', 'c1']);
    expect(result[0]?.score).toBeCloseTo(2 / 61 + 1 / 62);
    expect(result[0]?.summary).toBe('s2');
    expect(result[0]?.matchedEntities).toEqual(['A']);
  });

  it('truncates to topK', () => {
    const result = rankCommunitiesWithRRF(
      ['c1', 'c2'],
      ['c1', 'c2'],
      ['c1', 'c2'],
      communities,
      [],
      60,
      1,
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('c1');
  });
});

describe('rankCommunities', () => {
  it('builds overlap and structural rankings and fuses them with RRF', () => {
    const result = rankCommunities(['c1', 'c2'], communities, pairEdges, ['A'], ['c1', 'c2']);

    expect(result.map((community) => community.id)).toEqual(['c1', 'c2']);
    expect(result[0]?.score).toBeCloseTo(3 / 61);
    expect(result[0]?.summary).toBe('s1');
  });
});
