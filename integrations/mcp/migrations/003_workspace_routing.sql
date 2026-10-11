ALTER TABLE index_jobs
  ADD COLUMN IF NOT EXISTS workspace_id text NOT NULL DEFAULT 'default';

ALTER TABLE index_versions
  ADD COLUMN IF NOT EXISTS workspace_id text NOT NULL DEFAULT 'default';

ALTER TABLE building_snapshots
  ADD COLUMN IF NOT EXISTS workspace_id text NOT NULL DEFAULT 'default';

CREATE INDEX IF NOT EXISTS index_jobs_workspace_queue_idx
  ON index_jobs (workspace_id, created_at, id) WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS index_versions_workspace_published_idx
  ON index_versions (workspace_id, published_at DESC);

CREATE INDEX IF NOT EXISTS building_snapshots_workspace_idx
  ON building_snapshots (workspace_id);

ALTER TABLE active_index
  ADD COLUMN IF NOT EXISTS workspace_id text NOT NULL DEFAULT 'default';

ALTER TABLE active_index
  DROP CONSTRAINT IF EXISTS active_index_pkey;

ALTER TABLE active_index
  DROP CONSTRAINT IF EXISTS active_index_singleton_check;

ALTER TABLE active_index
  DROP COLUMN IF EXISTS singleton;

ALTER TABLE active_index
  ADD CONSTRAINT active_index_pkey PRIMARY KEY (workspace_id);
