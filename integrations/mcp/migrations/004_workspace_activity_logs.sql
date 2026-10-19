CREATE TABLE IF NOT EXISTS workspace_activity_logs (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  operation_id text NOT NULL,
  job_id text REFERENCES index_jobs(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('build', 'retrieval')),
  level text NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  message text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workspace_activity_logs_workspace_created_idx
  ON workspace_activity_logs (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS workspace_activity_logs_job_created_idx
  ON workspace_activity_logs (job_id, created_at ASC) WHERE job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS workspace_activity_logs_retrieval_idx
  ON workspace_activity_logs (workspace_id, created_at DESC) WHERE kind = 'retrieval';