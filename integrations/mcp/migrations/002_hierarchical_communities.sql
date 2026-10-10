ALTER TABLE "rag_community_summaries"
  ADD COLUMN IF NOT EXISTS "members" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "level" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "parent_community_id" TEXT,
  ADD COLUMN IF NOT EXISTS "content_fingerprint" CHAR(64);

CREATE TABLE IF NOT EXISTS version_query_leases (
  id text PRIMARY KEY,
  version_id text NOT NULL REFERENCES index_versions(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS version_query_leases_version_expiry_idx
  ON version_query_leases (version_id, expires_at);

CREATE TABLE IF NOT EXISTS building_snapshots (
  namespace text PRIMARY KEY,
  job_id text NOT NULL REFERENCES index_jobs(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rag_community_summaries_parent_community_id_fkey'
      AND conrelid = 'public.rag_community_summaries'::regclass
  ) THEN
    ALTER TABLE "rag_community_summaries"
      ADD CONSTRAINT "rag_community_summaries_parent_community_id_fkey"
      FOREIGN KEY ("parent_community_id")
      REFERENCES "rag_community_summaries"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "rag_community_summaries_parent_community_id_idx"
  ON "rag_community_summaries"("parent_community_id");

CREATE INDEX IF NOT EXISTS "rag_community_summaries_namespace_level_idx"
  ON "rag_community_summaries"("namespace", "level");