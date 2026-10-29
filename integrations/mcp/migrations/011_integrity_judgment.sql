CREATE TABLE IF NOT EXISTS integrity_snapshots (
  snapshot_id text PRIMARY KEY,
  built_at timestamptz NOT NULL,
  manifest jsonb NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  loaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS integrity_papers (
  snapshot_id text NOT NULL,
  paper_id text NOT NULL,
  doi text,
  title text,
  publication_year integer,
  venue text,
  cited_by_count integer,
  openalex_is_retracted boolean NOT NULL DEFAULT false,
  source_uri text NOT NULL,
  source_tier text NOT NULL,
  extraction_confidence numeric NOT NULL,
  fetched_at timestamptz NOT NULL,
  reference_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  reference_count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (snapshot_id, paper_id)
);

CREATE TABLE IF NOT EXISTS integrity_cites (
  snapshot_id text NOT NULL,
  citing_id text NOT NULL,
  cited_id text NOT NULL,
  cited_doi text,
  source_tier text NOT NULL,
  source_uri text NOT NULL,
  source_chunk_id text NOT NULL DEFAULT '',
  extraction_confidence numeric NOT NULL,
  context_snippet text,
  context_class text,
  context_source_tier text,
  context_source_uri text
);

CREATE TABLE IF NOT EXISTS integrity_retractions (
  snapshot_id text NOT NULL,
  paper_id text NOT NULL,
  doi text,
  source text NOT NULL,
  source_tier text NOT NULL,
  is_retracted boolean NOT NULL,
  retraction_date text,
  reason text,
  nature text,
  source_uri text NOT NULL,
  source_chunk_id text NOT NULL DEFAULT '',
  observed_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS integrity_judgments (
  id text PRIMARY KEY,
  snapshot_id text NOT NULL,
  paper_id text,
  input_ref text NOT NULL,
  judgment_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

UPDATE integrity_cites SET source_chunk_id='' WHERE source_chunk_id IS NULL;
ALTER TABLE integrity_cites ALTER COLUMN source_chunk_id SET DEFAULT '';
ALTER TABLE integrity_cites ALTER COLUMN source_chunk_id SET NOT NULL;
UPDATE integrity_retractions SET source_chunk_id='' WHERE source_chunk_id IS NULL;
ALTER TABLE integrity_retractions ALTER COLUMN source_chunk_id SET DEFAULT '';
ALTER TABLE integrity_retractions ALTER COLUMN source_chunk_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS integrity_snapshots_active_idx ON integrity_snapshots (is_active);
CREATE UNIQUE INDEX IF NOT EXISTS integrity_snapshots_single_active_idx ON integrity_snapshots ((is_active)) WHERE is_active=true;
CREATE INDEX IF NOT EXISTS integrity_papers_doi_idx ON integrity_papers (snapshot_id, lower(doi));
CREATE INDEX IF NOT EXISTS integrity_papers_snapshot_paper_idx ON integrity_papers (snapshot_id, paper_id);
CREATE INDEX IF NOT EXISTS integrity_cites_citing_idx ON integrity_cites (snapshot_id, citing_id);
CREATE INDEX IF NOT EXISTS integrity_cites_cited_idx ON integrity_cites (snapshot_id, cited_id);
CREATE UNIQUE INDEX IF NOT EXISTS integrity_cites_identity_columns_idx ON integrity_cites (snapshot_id,citing_id,cited_id,source_uri,source_chunk_id);
CREATE INDEX IF NOT EXISTS integrity_retractions_paper_idx ON integrity_retractions (snapshot_id, paper_id, is_retracted);
CREATE UNIQUE INDEX IF NOT EXISTS integrity_retractions_identity_columns_idx ON integrity_retractions (snapshot_id,paper_id,source,source_uri,source_chunk_id);
CREATE INDEX IF NOT EXISTS integrity_judgments_recent_idx ON integrity_judgments (created_at DESC);
CREATE INDEX IF NOT EXISTS integrity_judgments_snapshot_idx ON integrity_judgments (snapshot_id, paper_id);
