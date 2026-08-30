import { Prisma } from '@prisma/client';

import { prismaClient } from '../../build/helper/prismaClient';
import { getCurrentNamespace } from '../../namespace/namespaceContext';

export interface CommunitySummaryHit {
  id: string;
  similarity: number;
}

export interface ChildChunkHit {
  id: string;
  content: string;
  similarity: number;
}

export const vectorLiteral = (vector: number[]): Prisma.Sql =>
  Prisma.sql`CAST(${JSON.stringify(vector)} AS vector)`;

export async function searchSimilarCommunitySummaries(
  queryVector: number[],
  topK = 5,
): Promise<CommunitySummaryHit[]> {
  const query = vectorLiteral(queryVector);
  const rows = await prismaClient.$queryRaw<
    Array<{ id: string; similarity: number | string }>
  >(Prisma.sql`
    SELECT "id", 1 - ("summary_embedding" <=> ${query}) AS "similarity"
    FROM "rag_community_summaries"
    WHERE "summary_embedding" IS NOT NULL
      AND "namespace" = ${getCurrentNamespace()}
    ORDER BY "summary_embedding" <=> ${query}
    LIMIT ${topK}
  `);

  return rows.map((row) => ({ id: row.id, similarity: Number(row.similarity) }));
}

export async function searchSimilarChildChunks(
  queryVector: number[],
  topK = 5,
): Promise<ChildChunkHit[]> {
  const query = vectorLiteral(queryVector);
  const rows = await prismaClient.$queryRaw<
    Array<{ id: string; content: string; similarity: number | string }>
  >(Prisma.sql`
    SELECT "id", "content", 1 - ("embedding" <=> ${query}) AS "similarity"
    FROM "rag_children"
    WHERE "namespace" = ${getCurrentNamespace()}
    ORDER BY "embedding" <=> ${query}
    LIMIT ${topK}
  `);

  return rows.map((row) => ({
    id: row.id,
    content: row.content,
    similarity: Number(row.similarity),
  }));
}
