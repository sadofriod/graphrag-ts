import { describe, expect, it } from 'bun:test';

import type { GraphEdge } from '../../build/helper/buildEdges';
import { aggregateEdgeWeights, computeEdgeWeight, normalizeScore } from './scoring';

describe('aggregateEdgeWeights', () => {
  it('returns empty for empty input', () => {
    expect(aggregateEdgeWeights([])).toEqual([]);
  });

  it('counts duplicate edges as weight regardless of orientation', () => {
    const edges: GraphEdge[] = [
      { source: 'A', target: 'B' },
      { source: 'B', target: 'A' },
      { source: 'B', target: 'C' },
    ];

    expect(aggregateEdgeWeights(edges)).toEqual([
      { source: 'A', target: 'B', weight: 2 },
      { source: 'B', target: 'C', weight: 1 },
    ]);
  });

  it('normalizes undirected edge orientation to a canonical order', () => {
    const edges: GraphEdge[] = [
      { source: 'B', target: 'A' },
      { source: 'A', target: 'B' },
    ];
    const result = aggregateEdgeWeights(edges);

    expect(result[0]?.source).toBe('A');
    expect(result[0]?.target).toBe('B');
    expect(result[0]?.weight).toBe(2);
  });
});

describe('computeEdgeWeight', () => {
  it('sums weights of connecting edges regardless of direction', () => {
    const edges = [
      { source: 'A', target: 'B', weight: 2 },
      { source: 'B', target: 'A', weight: 3 },
      { source: 'A', target: 'C', weight: 5 },
    ];

    expect(computeEdgeWeight('A', 'B', edges)).toBe(5);
  });

  it('defaults missing weight to 1', () => {
    const edges = [{ source: 'A', target: 'B' }];

    expect(computeEdgeWeight('A', 'B', edges)).toBe(1);
  });

  it('returns 0 when no edge connects the entities', () => {
    const edges = [{ source: 'A', target: 'B', weight: 1 }];

    expect(computeEdgeWeight('A', 'C', edges)).toBe(0);
  });
});

describe('normalizeScore', () => {
  it('clamps scores into [0, 1]', () => {
    expect(normalizeScore(0.5)).toBe(0.5);
    expect(normalizeScore(-1)).toBe(0);
    expect(normalizeScore(2)).toBe(1);
    expect(normalizeScore(0)).toBe(0);
    expect(normalizeScore(1)).toBe(1);
  });
});
