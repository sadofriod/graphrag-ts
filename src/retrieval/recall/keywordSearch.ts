import { Prisma } from '@prisma/client';

import { prismaClient } from '../../build/helper/prismaClient';
import { getCurrentNamespace } from '../../namespace/namespaceContext';

/**
 * 子块关键词召回：按查询关键词（实体名 + 关键词）做子串（ILIKE）匹配，
 * 直接命中包含精确事实短语的原始子块，弥补向量召回「相关但不精确」的短板。
 * 按「命中关键词数 + 子块长度」排序（更长的块更可能含完整事实）。
 *
 * 与 `searchSimilarChildChunks`（向量）合并去重后进入证据，见 `mergeChildChunks`。
 */

export interface KeywordChunkHit {
  id: string;
  content: string;
  matches: number;
}

export interface MergeableChunk {
  id: string;
  content: string;
}

const KEYWORD_CAP = 16;

/** 供关键词召回取词的候选源（来自查询意图 + 实体匹配结果）。 */
export interface KeywordSource {
  intentEntities: readonly string[];
  intentKeywords: readonly string[];
  matched: readonly { name: string; matchType: string }[];
}

/**
 * 组装关键词候选，按「精确优先」排序：
 * intent 实体（LLM 高置信） → 实体精确/别名匹配 → 查询关键词 → 模糊/语义匹配。
 * 先让高置信词进入（keywordSearch 内部会截断到 KEYWORD_CAP），避免低分模糊匹配挤掉精确词。
 */
export function buildKeywordTerms(source: KeywordSource): string[] {
  const exact = source.matched
    .filter((m) => m.matchType === 'exact' || m.matchType === 'alias')
    .map((m) => m.name);
  const fuzzy = source.matched
    .filter((m) => m.matchType !== 'exact' && m.matchType !== 'alias')
    .map((m) => m.name);
  return [
    ...source.intentEntities,
    ...exact,
    ...source.intentKeywords,
    ...fuzzy,
  ];
}

const normalize = (keywords: readonly string[]): string[] => {
  const unique = new Set<string>();
  for (const keyword of keywords) {
    const trimmed = keyword.trim();
    if (trimmed.length > 0) {
      unique.add(trimmed);
    }
  }
  return Array.from(unique).slice(0, KEYWORD_CAP);
};

const patternOf = (keyword: string): Prisma.Sql =>
  Prisma.sql`"content" ILIKE ${`%${keyword}%`}`;

export async function searchChildChunksByKeywords(
  keywords: readonly string[],
  limit = 12,
): Promise<KeywordChunkHit[]> {
  const capped = normalize(keywords);
  if (capped.length === 0) {
    return [];
  }

  const scoreExpr = Prisma.join(
    capped.map((keyword) => Prisma.sql`(${patternOf(keyword)})::int`),
    ' + ',
  );
  const whereExpr = Prisma.join(capped.map(patternOf), ' OR ');

  const rows = await prismaClient.$queryRaw<Array<{ id: string; content: string; matches: number }>>(
    Prisma.sql`
      SELECT "id", "content", ${scoreExpr} AS "matches"
      FROM "rag_children"
      WHERE "namespace" = ${getCurrentNamespace()} AND (${whereExpr})
      ORDER BY "matches" DESC, char_length("content") DESC
      LIMIT ${limit}
    `,
  );

  return rows.map((row) => ({ id: row.id, content: row.content, matches: row.matches }));
}

/** 主序（向量）优先、次序（关键词）补充，按 id 去重后截断到 cap。 */
export function mergeChildChunks(
  primary: readonly MergeableChunk[],
  secondary: readonly MergeableChunk[],
  cap: number,
): MergeableChunk[] {
  const result: MergeableChunk[] = [];
  const seen = new Set<string>();
  for (const chunk of [...primary, ...secondary]) {
    if (result.length >= cap) {
      break;
    }
    if (seen.has(chunk.id)) {
      continue;
    }
    seen.add(chunk.id);
    result.push(chunk);
  }
  return result;
}
