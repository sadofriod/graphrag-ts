import { describe, expect, it } from 'bun:test';

import type { GraphEdge } from '../../build/helper/buildEdges';
import { buildNeighborMap, expandNeighbors } from './graphExpander';

const chain: GraphEdge[] = [
  { source: 'A', target: 'B' },
  { source: 'B', target: 'C' },
  { source: 'C', target: 'D' },
];

describe('buildNeighborMap', () => {
  it('indexes every edge from both endpoints', () => {
    const map = buildNeighborMap(chain);

    expect(map.get('A')).toEqual([{ source: 'A', target: 'B' }]);
    expect(map.get('B')).toEqual([
      { source: 'A', target: 'B' },
      { source: 'B', target: 'C' },
    ]);
    expect(map.get('D')).toEqual([{ source: 'C', target: 'D' }]);
  });
});

describe('expandNeighbors', () => {
  it('expands one hop by default', () => {
    expect(expandNeighbors(['A'], chain)).toEqual(['B']);
  });

  it('expands to the given depth in BFS order', () => {
    expect(expandNeighbors(['A'], chain, 2)).toEqual(['B', 'C']);
    expect(expandNeighbors(['A'], chain, 3)).toEqual(['B', 'C', 'D']);
  });

  it('excludes seed entities from the result', () => {
    expect(expandNeighbors(['A', 'B'], chain, 2)).toEqual(['C', 'D']);
  });

  it('returns empty for no seeds or no reachable neighbors', () => {
    expect(expandNeighbors([], chain)).toEqual([]);
    expect(expandNeighbors(['X'], chain)).toEqual([]);
  });

  it('deduplicates neighbors reached through multiple paths', () => {
    const duplicateEdge: GraphEdge[] = [
      { source: 'A', target: 'B' },
      { source: 'A', target: 'B' },
    ];

    expect(expandNeighbors(['A'], duplicateEdge, 1)).toEqual(['B']);
  });
});
