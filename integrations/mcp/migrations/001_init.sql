CREATE INDEX IF NOT EXISTS ragchild_embedding_hnsw_idx ON rag_children
  USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS index_jobs (
  id text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  phase text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  error_code text,
  error_summary text,
  published_version_id text
);

CREATE INDEX IF NOT EXISTS index_jobs_queue_idx
  ON index_jobs (created_at, id) WHERE status = 'queued';

CREATE TABLE IF NOT EXISTS job_inputs (
  job_id text NOT NULL REFERENCES index_jobs(id) ON DELETE CASCADE,
  ordinal integer NOT NULL,
  source_label text NOT NULL,
  content text NOT NULL,
  content_hash text NOT NULL,
  media_type text NOT NULL,
  PRIMARY KEY (job_id, ordinal)
);

CREATE TABLE IF NOT EXISTS knowledge_sources (
  id text PRIMARY KEY,
  created_by_job_id text NOT NULL REFERENCES index_jobs(id),
  source_label text NOT NULL,
  content text NOT NULL,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS index_versions (
  id text PRIMARY KEY,
  namespace text NOT NULL UNIQUE,
  created_by_job_id text NOT NULL REFERENCES index_jobs(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS index_version_sources (
  version_id text NOT NULL REFERENCES index_versions(id) ON DELETE CASCADE,
  source_id text NOT NULL REFERENCES knowledge_sources(id),
  PRIMARY KEY (version_id, source_id)
);

CREATE TABLE IF NOT EXISTS active_index (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  version_id text NOT NULL REFERENCES index_versions(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);