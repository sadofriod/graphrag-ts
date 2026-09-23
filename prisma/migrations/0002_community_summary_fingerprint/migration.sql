-- Existing rows intentionally remain NULL until the next summary persistence run.
-- Runtime reuse checks treat NULL fingerprints as stale and regenerate those summaries in place.
ALTER TABLE "rag_community_summaries"
ADD COLUMN "content_fingerprint" CHAR(64);