import { Prisma } from '@prisma/client';

interface ChildInsertRow {
  parentId: string;
  content: string;
  embedding: number[];
}

export const buildChildInsertSql = (children: ChildInsertRow[], namespace: string) => {
  if (children.length === 0) {
    return Prisma.sql``;
  }

  // id/updated_at have no database-level DEFAULT (Prisma's @default(cuid())/@updatedAt are generated only in the client layer),
  // so native SQL inserts must provide them explicitly or they will violate the NOT NULL constraint (23502).
  return Prisma.sql`
    INSERT INTO "rag_children" ("id", "namespace", "content", "parent_id", "embedding", "fts_tokens", "updated_at")
    VALUES ${Prisma.join(
      children.map(({ parentId, content, embedding }) =>
        Prisma.sql`(${crypto.randomUUID()}, ${namespace}, ${content}, ${parentId}, CAST(${JSON.stringify(embedding)} AS vector), to_tsvector('english', ${content}), now())`
      ),
      ','
    )}
    RETURNING "id"
  `;
};