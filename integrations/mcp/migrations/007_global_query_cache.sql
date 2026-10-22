CREATE TABLE IF NOT EXISTS "rag_global_query_cache" (
  "namespace" TEXT NOT NULL,
  "cache_key" CHAR(64) NOT NULL,
  "result" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("namespace", "cache_key")
);