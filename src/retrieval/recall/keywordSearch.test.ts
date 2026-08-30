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
      intentEntities: ['有限重置'],
      intentKeywords: ['关闭'],
      matched: [
        { name: '凯', matchType: 'exact' },
        { name: '防静电袋', matchType: 'semantic' },
        { name: '暗路', matchType: 'fuzzy' },
      ],
    });

    expect(terms).toEqual(['有限重置', '凯', '关闭', '防静电袋', '暗路']);
  });

  it('returns only precise sources when there are no fuzzy matches', () => {
    const terms = buildKeywordTerms({
      intentEntities: ['先知'],
      intentKeywords: ['离线'],
      matched: [{ name: '幽灵数据团', matchType: 'exact' }],
    });

    expect(terms).toEqual(['先知', '幽灵数据团', '离线']);
  });
});

describe('searchChildChunksByKeywords', () => {
  it('returns keyword-matched chunks with match counts', async () => {
    const originalQueryRaw = prismaClient.$queryRaw;
    const calls: unknown[] = [];

    prismaClient.$queryRaw = (async (query: unknown) => {
      calls.push(query);
      return [
        { id: 'c1', content: '零点协议需要三把钥匙', matches: 2 },
        { id: 'c2', content: '老星轨是创始人', matches: 1 },
      ];
    }) as never;

    try {
      const result = await searchChildChunksByKeywords(['零点协议', '三把钥匙']);

      expect(result).toEqual([
        { id: 'c1', content: '零点协议需要三把钥匙', matches: 2 },
        { id: 'c2', content: '老星轨是创始人', matches: 1 },
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
      await searchChildChunksByKeywords([' 零点协议 ', '零点协议', '']);

      const sql = calls[0] as { values?: unknown[] };
      const patterns = (sql.values ?? []).filter(
        (value) => typeof value === 'string' && value.includes('零点协议'),
      );
      // 去重 + 去空白 + 过滤空串后只保留 1 个关键词；它在「评分表达式 + WHERE」各出现一次
      expect(patterns).toEqual(['%零点协议%', '%零点协议%']);
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
