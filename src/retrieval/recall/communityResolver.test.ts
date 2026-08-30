import { describe, expect, it } from 'bun:test';

import { prismaClient } from '../../build/helper/prismaClient';
import { recallCommunitiesByTopology } from './communityResolver';

describe('recallCommunitiesByTopology', () => {
  it('returns communities and expanded entities from the traversed rows', async () => {
    const originalQueryRaw = prismaClient.$queryRaw;
    const calls: unknown[] = [];

    prismaClient.$queryRaw = (async (query: unknown) => {
      calls.push(query);
      return [
        { community_id: 'c1', entity_id: 'e1' },
        { community_id: 'c2', entity_id: 'e2' },
      ];
    }) as never;

    try {
      const result = await recallCommunitiesByTopology(['A', 'B']);

      expect(result.communityIds).toEqual(['c1', 'c2']);
      expect(result.expandedEntityIds).toEqual(['e1', 'e2']);

      const sql = calls[0] as { text?: string };
      expect(sql.text).toContain('rag_graph_edges');
      expect(sql.text).toContain('community_summary_id');
      expect(sql.text).toContain('RECURSIVE');
      expect(sql.text).toContain('hop');
      expect(sql.text).toContain('"namespace"');
      // 回归：仅允许单个递归分支（单 UNION），否则 PG 抛 42P19
      // "recursive reference to query reachable must not appear within its non-recursive term"。
      expect(sql.text?.match(/UNION/g)?.length).toBe(1);
      expect(sql.text).toContain('CASE WHEN');
    } finally {
      prismaClient.$queryRaw = originalQueryRaw;
    }
  });

  it('deduplicates communities across multiple hit entities', async () => {
    const originalQueryRaw = prismaClient.$queryRaw;

    prismaClient.$queryRaw = (async () => [
      { community_id: 'c1', entity_id: 'e1' },
      { community_id: 'c1', entity_id: 'e2' },
      { community_id: 'c2', entity_id: 'e1' },
    ]) as never;

    try {
      const result = await recallCommunitiesByTopology(['A']);

      expect(result.communityIds).toEqual(['c1', 'c2']);
      expect(result.expandedEntityIds).toEqual(['e1', 'e2']);
    } finally {
      prismaClient.$queryRaw = originalQueryRaw;
    }
  });

  it('skips communities with a null id', async () => {
    const originalQueryRaw = prismaClient.$queryRaw;

    prismaClient.$queryRaw = (async () => [
      { community_id: null, entity_id: 'e1' },
      { community_id: 'c2', entity_id: 'e2' },
    ]) as never;

    try {
      const result = await recallCommunitiesByTopology(['A']);

      expect(result.communityIds).toEqual(['c2']);
    } finally {
      prismaClient.$queryRaw = originalQueryRaw;
    }
  });

  it('returns empty without querying when there are no seeds', async () => {
    const originalQueryRaw = prismaClient.$queryRaw;
    let called = false;

    prismaClient.$queryRaw = (async () => {
      called = true;
      return [];
    }) as never;

    try {
      const result = await recallCommunitiesByTopology([]);

      expect(result).toEqual({ communityIds: [], expandedEntityIds: [] });
      expect(called).toBe(false);
    } finally {
      prismaClient.$queryRaw = originalQueryRaw;
    }
  });
});
