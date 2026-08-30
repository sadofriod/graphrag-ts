import { describe, expect, it } from 'bun:test';

import { prismaClient } from '../../build/helper/prismaClient';
import { searchSimilarChildChunks, searchSimilarCommunitySummaries } from './vectorSearch';

describe('searchSimilarCommunitySummaries', () => {
  it('maps rows returned by the vector search onto hits', async () => {
    const originalQueryRaw = prismaClient.$queryRaw;
    const calls: unknown[] = [];

    prismaClient.$queryRaw = (async (query: unknown) => {
      calls.push(query);
      return [
        { id: 'c1', similarity: 0.9 },
        { id: 'c2', similarity: 0.7 },
      ];
    }) as never;

    try {
      const result = await searchSimilarCommunitySummaries([0.1, 0.2], 2);

      expect(result).toEqual([
        { id: 'c1', similarity: 0.9 },
        { id: 'c2', similarity: 0.7 },
      ]);
      expect((calls[0] as { text?: string }).text).toContain('rag_community_summaries');
      expect((calls[0] as { text?: string }).text).toContain('<=>');
      expect((calls[0] as { text?: string }).text).toContain('"namespace"');
    } finally {
      prismaClient.$queryRaw = originalQueryRaw;
    }
  });

  it('coerces string similarities to numbers', async () => {
    const originalQueryRaw = prismaClient.$queryRaw;

    prismaClient.$queryRaw = (async () => [{ id: 'c1', similarity: '0.85' }]) as never;

    try {
      const result = await searchSimilarCommunitySummaries([0.1], 1);

      expect(result[0]?.similarity).toBe(0.85);
    } finally {
      prismaClient.$queryRaw = originalQueryRaw;
    }
  });
});

describe('searchSimilarChildChunks', () => {
  it('maps rows including content onto hits', async () => {
    const originalQueryRaw = prismaClient.$queryRaw;
    const calls: unknown[] = [];

    prismaClient.$queryRaw = (async (query: unknown) => {
      calls.push(query);
      return [{ id: 'ch1', content: 'some text', similarity: 0.8 }];
    }) as never;

    try {
      const result = await searchSimilarChildChunks([0.1], 1);

      expect(result).toEqual([{ id: 'ch1', content: 'some text', similarity: 0.8 }]);
      expect((calls[0] as { text?: string }).text).toContain('rag_children');
      expect((calls[0] as { text?: string }).text).toContain('"namespace"');
    } finally {
      prismaClient.$queryRaw = originalQueryRaw;
    }
  });
});
