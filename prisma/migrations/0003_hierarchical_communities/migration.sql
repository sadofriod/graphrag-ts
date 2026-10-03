ALTER TABLE "rag_community_summaries"
ADD COLUMN "members" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "level" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "parent_community_id" TEXT;

ALTER TABLE "rag_community_summaries"
ADD CONSTRAINT "rag_community_summaries_parent_community_id_fkey"
FOREIGN KEY ("parent_community_id")
REFERENCES "rag_community_summaries"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

CREATE INDEX "rag_community_summaries_parent_community_id_idx"
ON "rag_community_summaries"("parent_community_id");

CREATE INDEX "rag_community_summaries_namespace_level_idx"
ON "rag_community_summaries"("namespace", "level");