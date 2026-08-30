import { describe, expect, it } from 'bun:test';

import { prismaClient } from '../../helper/prismaClient';
import { loadCommunityGraph } from './loadCommunityGraph';

describe('loadCommunityGraph', () => {
  const originalFindMany = prismaClient.rAGGraphEdge.findMany;

  it('maps ordered graph edges into community edges', async () => {
    prismaClient.rAGGraphEdge.findMany = (() =>
      Promise.resolve([
        { sourceEntity: { name: 'Alpha' }, targetEntity: { name: 'Beta' }, weight: 4 },
        { sourceEntity: { name: 'Beta' }, targetEntity: { name: 'Gamma' }, weight: 2 },
      ]) as never) as typeof prismaClient.rAGGraphEdge.findMany;

    try {
      const result = await loadCommunityGraph();
      expect(result.edges).toEqual([
        { source: 'Alpha', target: 'Beta', weight: 4 },
        { source: 'Beta', target: 'Gamma', weight: 2 },
      ]);
    } finally {
      prismaClient.rAGGraphEdge.findMany = originalFindMany;
    }
  });

  it('falls back to weight 1 when the edge has no weight', async () => {
    prismaClient.rAGGraphEdge.findMany = (() =>
      Promise.resolve([
        { sourceEntity: { name: 'Alpha' }, targetEntity: { name: 'Beta' }, weight: null },
      ]) as never) as typeof prismaClient.rAGGraphEdge.findMany;

    try {
      const result = await loadCommunityGraph();
      expect(result.edges).toEqual([{ source: 'Alpha', target: 'Beta', weight: 1 }]);
    } finally {
      prismaClient.rAGGraphEdge.findMany = originalFindMany;
    }
  });
});
