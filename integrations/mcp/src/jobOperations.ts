import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { BuildSource, JobRecord, JobStatus, Transaction } from './store.ts';
import type { WorkspaceId } from './workspace.ts';

export type ActivityLogInput = {
  readonly workspaceId: WorkspaceId;
  readonly operationId: string;
  readonly jobId?: string;
  readonly kind: 'build' | 'retrieval';
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly details?: Record<string, unknown>;
};

export type ActivityLogRecord = {
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly operationId: string;
  readonly jobId: string | null;
  readonly kind: 'build' | 'retrieval';
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly details: Record<string, unknown>;
  readonly createdAt: Date;
};

type DatabaseJob = {
  id: string;
  workspace_id: string;
  status: JobStatus;
  phase: string | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  error_code: string | null;
  error_summary: string | null;
  version_id: string | null;
};

const asJobRecord = (row: DatabaseJob): JobRecord => ({
  id: row.id,
  workspaceId: row.workspace_id,
  status: row.status,
  phase: row.phase,
  createdAt: row.created_at,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  errorCode: row.error_code,
  errorSummary: row.error_summary,
  publishedVersion: row.version_id ? { id: row.version_id, workspaceId: row.workspace_id } : null,
});

export const createActivityOperations = (pool: Pool) => {
  const listWorkspaces = async (): Promise<readonly string[]> => {
    const result = await pool.query<{ workspace_id: string }>(
      `SELECT workspace_id FROM (
         SELECT workspace_id FROM index_jobs
         UNION
         SELECT workspace_id FROM index_versions
       ) AS workspaces ORDER BY workspace_id`,
    );
    return [...new Set(['default', ...result.rows.map((row) => row.workspace_id)])]
      .sort((left, right) => left === 'default' ? -1 : right === 'default' ? 1 : left.localeCompare(right));
  };

  const appendActivityLog = async (input: ActivityLogInput): Promise<void> => {
    await pool.query(
      `INSERT INTO workspace_activity_logs
         (id, workspace_id, operation_id, job_id, kind, level, message, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [randomUUID(), input.workspaceId, input.operationId, input.jobId ?? null, input.kind,
        input.level, input.message, JSON.stringify(input.details ?? {})],
    );
  };

  const listJobLogs = async (workspaceId: WorkspaceId, jobId: string): Promise<readonly ActivityLogRecord[]> => {
    const result = await pool.query<ActivityLogRecord>(
      `SELECT id, workspace_id AS "workspaceId", operation_id AS "operationId", job_id AS "jobId",
              kind, level, message, details, created_at AS "createdAt"
       FROM workspace_activity_logs
       WHERE workspace_id = $1 AND job_id = $2 AND kind = 'build'
       ORDER BY created_at, id`,
      [workspaceId, jobId],
    );
    return result.rows;
  };

  const listRetrievalLogs = async (workspaceId: WorkspaceId): Promise<readonly ActivityLogRecord[]> => {
    const result = await pool.query<ActivityLogRecord>(
      `SELECT id, workspace_id AS "workspaceId", operation_id AS "operationId", job_id AS "jobId",
              kind, level, message, details, created_at AS "createdAt"
       FROM workspace_activity_logs
       WHERE workspace_id = $1 AND kind = 'retrieval'
       ORDER BY created_at DESC, id DESC
       LIMIT 100`,
      [workspaceId],
    );
    return result.rows;
  };

  return { appendActivityLog, listJobLogs, listRetrievalLogs, listWorkspaces };
};

export const createJobOperations = (
  pool: Pool,
  transaction: Transaction,
  deleteGraphNamespace: (client: PoolClient, namespace: string) => Promise<void>,
) => {
  const getJob = async (id: string, workspaceId: WorkspaceId): Promise<JobRecord | null> => {
    const result = await pool.query<DatabaseJob>(
      `SELECT j.id, j.workspace_id, j.status, j.phase, j.created_at, j.started_at, j.finished_at,
              j.error_code, j.error_summary, v.id AS version_id
       FROM index_jobs j LEFT JOIN index_versions v ON v.id = j.published_version_id
       WHERE j.id = $1 AND j.workspace_id = $2`,
      [id, workspaceId],
    );
    const row = result.rows[0];
    return row ? asJobRecord(row) : null;
  };

  const getInputs = async (jobId: string): Promise<readonly BuildSource[]> => {
    const result = await pool.query<BuildSource>(
      `SELECT source_label AS "sourceLabel", content, content_hash AS "contentHash"
       FROM job_inputs WHERE job_id = $1 ORDER BY ordinal`,
      [jobId],
    );
    return result.rows;
  };

  const listJobs = async (workspaceId: WorkspaceId): Promise<readonly JobRecord[]> => {
    const result = await pool.query<DatabaseJob>(
      `SELECT j.id, j.workspace_id, j.status, j.phase, j.created_at, j.started_at, j.finished_at,
              j.error_code, j.error_summary, v.id AS version_id
       FROM index_jobs j LEFT JOIN index_versions v ON v.id = j.published_version_id
       WHERE j.workspace_id = $1
       ORDER BY CASE j.status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END,
                j.created_at DESC, j.id DESC
       LIMIT 50`,
      [workspaceId],
    );
    return result.rows.map(asJobRecord);
  };

  const fail = async (jobId: string, errorCode: string, summary: string): Promise<void> => {
    await pool.query(
      `UPDATE index_jobs SET status = 'failed', phase = 'failed', finished_at = now(),
       error_code = $2, error_summary = $3 WHERE id = $1 AND status IN ('queued', 'running')`,
      [jobId, errorCode, summary.slice(0, 500)],
    );
  };

  const recoverInterruptedJobs = async (): Promise<void> => {
    await transaction(async (client) => {
      await client.query(
        `UPDATE index_jobs SET status = 'failed', phase = 'failed', finished_at = now(),
         error_code = 'WORKER_RESTARTED', error_summary = 'Worker stopped before this job completed.'
         WHERE status = 'running'`,
      );
      const interruptedSnapshots = await client.query<{ namespace: string }>(
        'SELECT namespace FROM building_snapshots FOR UPDATE',
      );
      for (const snapshot of interruptedSnapshots.rows) {
        await deleteGraphNamespace(client, snapshot.namespace);
      }
      await client.query('DELETE FROM building_snapshots');
    });
  };

  const setPhase = async (jobId: string, phase: string): Promise<void> => {
    await pool.query(
      `UPDATE index_jobs SET phase = $2 WHERE id = $1 AND status = 'running'`,
      [jobId, phase],
    );
  };

  return { fail, getInputs, getJob, listJobs, recoverInterruptedJobs, setPhase };
};
