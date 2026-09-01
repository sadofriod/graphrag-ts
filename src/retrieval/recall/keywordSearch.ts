import { Prisma } from '@prisma/client';

import { prismaClient } from '../../build/helper/prismaClient';
import { getCurrentNamespace } from '../../namespace/namespaceContext';

/**
 * Child-chunk keyword recall: perform substring (ILIKE) matching using query terms (entity names + keywords),
 * to directly hit source child chunks that contain exact fact phrases and compensate for vector recall returning relevant-but-imprecise results.
 * Sort by the number of matched keywords plus child-chunk length (longer chunks
 * are more likely to contain a complete fact).
 *
 * Merge and deduplicate the results with `searchSimilarChildChunks` (vector search) before they enter evidence; see `mergeChildChunks`.
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

/** Candidate term sources for keyword recall (from query intent + entity matching results). */
export interface KeywordSource {
  intentEntities: readonly string[];
  intentKeywords: readonly string[];
  matched: readonly { name: string; matchType: string }[];
}

/**
 * Assemble keyword candidates with exact matches first:
 * intent entities (high-confidence from the LLM) -> exact/alias entity matches -> query keywords -> fuzzy/semantic matches.
 * Let high-confidence terms enter first (`keywordSearch` truncates internally to KEYWORD_CAP) so low-scoring fuzzy matches do not crowd out exact ones.
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

/** Keep the primary order from vector recall, supplement with keyword recall, deduplicate by id, and then truncate to cap. */
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
