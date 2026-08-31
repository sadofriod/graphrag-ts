import { describe, expect, it } from 'bun:test';

import { prismaClient } from '../../build/helper/prismaClient';
import {
  buildKeywordTerms,
  mergeChildChunks,
  searchChildChunksByKeywords,
} from './keywordSearch';

describe('buildKeywordTerms', () => {
  it('orders intent entities, exact/alias matches and keywords before fuzzy/semantic ones', () => {
    const terms = buildKeywordTerms({
      intentEntities: ['limited reset'],
      intentKeywords: ['shutdown'],
      matched: [
        { name: 'Kai', matchType: 'exact' },
        { name: 'anti-static bag', matchType: 'semantic' },
        { name: 'dark path', matchType: 'fuzzy' },
      ],
    });

    expect(terms).toEqual(['limited reset', 'Kai', 'shutdown', 'anti-static bag', 'dark path']);
  });

  it('returns only precise sources when there are no fuzzy matches', () => {
    const terms = buildKeywordTerms({
      intentEntities: ['prophet'],
      intentKeywords: ['offline'],
      matched: [{ name: 'Ghost Data Guild', matchType: 'exact' }],
    });

    expect(terms).toEqual(['prophet', 'Ghost Data Guild', 'offline']);
  });
});

describe('searchChildChunksByKeywords', () => {
  it('returns keyword-matched chunks with match counts', async () => {
    const originalQueryRaw = prismaClient.$queryRaw;
    const calls: unknown[] = [];

    prismaClient.$queryRaw = (async (query: unknown) => {
      calls.push(query);
      return [
        { id: 'c1', content: 'The midnight protocol needs three keys', matches: 2 },
        { id: 'c2', content: 'Old Starrail is the founder', matches: 1 },
      ];
    }) as never;

    try {
      const result = await searchChildChunksByKeywords(['midnight protocol', 'three keys']);

      expect(result).toEqual([
        { id: 'c1', content: 'The midnight protocol needs three keys', matches: 2 },
        { id: 'c2', content: 'Old Starrail is the founder', matches: 1 },
      ]);

      const sql = calls[0] as { text?: string };
      expect(sql.text).toContain('rag_children');
      expect(sql.text).toContain('ILIKE');
      expect(sql.text).toContain('matches');
      expect(sql.text).toContain('char_length');
    } finally {
      prismaClient.$queryRaw = originalQueryRaw;
    }
  });

  it('deduplicates and trims keywords', async () => {
    const originalQueryRaw = prismaClient.$queryRaw;
    const calls: unknown[] = [];

    prismaClient.$queryRaw = (async (query: unknown) => {
      calls.push(query);
      return [];
    }) as never;

    try {
      await searchChildChunksByKeywords([' midnight protocol ', 'midnight protocol', '']);

      const sql = calls[0] as { values?: unknown[] };
      const patterns = (sql.values ?? []).filter(
        (value) => typeof value === 'string' && value.includes('midnight protocol'),
      );
      // After deduplication, trimming, and empty-string filtering, only one keyword remains; it appears once in the scoring expression and once in WHERE.
      expect(patterns).toEqual(['%midnight protocol%', '%midnight protocol%']);
    } finally {
      prismaClient.$queryRaw = originalQueryRaw;
    }
  });

  it('returns empty without querying when keywords are empty', async () => {
    const originalQueryRaw = prismaClient.$queryRaw;
    let called = false;

    prismaClient.$queryRaw = (async () => {
      called = true;
      return [];
    }) as never;

    try {
      const result = await searchChildChunksByKeywords([]);

      expect(result).toEqual([]);
      expect(called).toBe(false);
    } finally {
      prismaClient.$queryRaw = originalQueryRaw;
    }
  });
});

describe('mergeChildChunks', () => {
  it('keeps primary order, dedupes by id, and caps the total', () => {
    const primary = [
      { id: 'a', content: 'A', similarity: 0.9 },
      { id: 'b', content: 'B', similarity: 0.8 },
    ];
    const secondary = [
      { id: 'b', content: 'B', matches: 1 },
      { id: 'c', content: 'C', matches: 2 },
      { id: 'd', content: 'D', matches: 1 },
    ];

    const merged = mergeChildChunks(primary, secondary, 3);

    expect(merged.map((chunk) => chunk.id)).toEqual(['a', 'b', 'c']);
  });

  it('returns secondary chunks when primary is empty', () => {
    const merged = mergeChildChunks([], [{ id: 'x', content: 'X' }], 5);

    expect(merged.map((chunk) => chunk.id)).toEqual(['x']);
  });
});
