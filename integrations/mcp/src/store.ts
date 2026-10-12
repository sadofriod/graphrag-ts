import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool, type PoolClient } from 'pg';
import { fileURLToPath } from 'node:url';
import type { JobInput } from './input.ts';
import { createPublisher } from './publisher.ts';
import { DEFAULT_WORKSPACE_ID, type WorkspaceId } from './workspace.ts';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export type JobRecord = {
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly status: JobStatus;
  readonly phase: string | null;
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly errorCode: string | null;
  readonly errorSummary: string | null;
  readonly publishedVersion: { readonly id: string; readonly workspaceId: WorkspaceId } | null;
};

export type SourceRecord = {
  readonly id: string;
  readonly sourceLabel: string;
  readonly content: string;
};

export type BuildSource = Pick<SourceRecord, 'sourceLabel' | 'content'>;

export type ActiveSnapshot = {
  readonly workspaceId: WorkspaceId;
  readonly version: { readonly id: string; readonly namespace: string } | null;
  readonly sources: readonly SourceRecord[];
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
  publishedVersion:
    row.version_id
      ? { id: row.version_id, workspaceId: row.workspace_id }
      : null,
});

export type Transaction = <Result>(operation: (client: PoolClient) => Promise<Result>) => Promise<Result>;

const deleteGraphNamespace = async (client: PoolClient, namespace: string): Promise<void> => {
  await client.query('DELETE FROM rag_claims WHERE namespace = $1', [namespace]);
  await client.query('DELETE FROM rag_graph_edges WHERE namespace = $1', [namespace]);
  await client.query('DELETE FROM rag_community_summaries WHERE namespace = $1', [namespace]);
  await client.query('DELETE FROM rag_parents WHERE namespace = $1', [namespace]);
  await client.query('DELETE FROM rag_entities WHERE namespace = $1', [namespace]);
  await client.query('DELETE FROM generation_jobs WHERE namespace = $1', [namespace]);
};

const inTransaction = (pool: Pool): Transaction => async (operation) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const ensureGraphSchema = async (pool: Pool): Promise<void> => {
  await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
  const requiredTables = [
    'rag_parents',
    'rag_children',
    'rag_entities',
    'rag_graph_edges',
    'rag_community_summaries',
    'rag_claims',
    'generation_jobs',
  ];
  const checkTables = async (): Promise<readonly string[]> => {
    const result = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM unnest($1::text[]) AS table_name
       WHERE to_regclass(format('public.%I', table_name)) IS NOT NULL`,
      [requiredTables],
    );
    return result.rows.map((row) => row.table_name);
  };

  const existingTables = await checkTables();
  if (existingTables.length > 0 && existingTables.length < requiredTables.length) {
    const missingTables = requiredTables.filter((table) => !existingTables.includes(table));
    throw new Error(`Existing GraphRAG schema is incomplete; missing tables: ${missingTables.join(', ')}.`);
  }
  if (existingTables.length === 0) {
    const child = Bun.spawn(
      [
        './node_modules/.bin/prisma',
        'db',
        'push',
        '--schema',
        'node_modules/@ashes_born/graph-rag-ts/prisma/schema.prisma',
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    const [, , exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (exitCode !== 0) {
      throw new Error('GraphRAG schema initialization failed; check the Prisma startup output.');
    }
    const createdTables = await checkTables();
    const missingTables = requiredTables.filter((table) => !createdTables.includes(table));
    if (missingTables.length > 0) {
      throw new Error(`GraphRAG schema initialization is incomplete; missing tables: ${missingTables.join(', ')}.`);
    }
  }
};

const migrate = async (pool: Pool): Promise<void> => {
  for (const migration of [
    '001_init.sql',
    '002_hierarchical_communities.sql',
    '003_workspace_routing.sql',
  ]) {
    const migrationPath = fileURLToPath(new URL(`../migrations/${migration}`, import.meta.url));
    await pool.query(await readFile(migrationPath, 'utf8'));
  }
};

const createQueueOperations = (pool: Pool, transaction: Transaction) => {
  const enqueue = async (
    inputs: readonly JobInput[],
    workspaceId: WorkspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<{ id: string; queuePosition: number }> => {
    const id = randomUUID();
    return transaction(async (client) => {
      await client.query(
        'INSERT INTO index_jobs (id, workspace_id, status, phase) VALUES ($1, $2, $3, $4)',
        [id, workspaceId, 'queued', 'queued'],
      );
      for (const [ordinal, input] of inputs.entries()) {
        await client.query(
          `INSERT INTO job_inputs (job_id, ordinal, source_label, content, content_hash, media_type)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, ordinal, input.sourceLabel, input.content, input.contentHash, input.mediaType],
        );
      }
      const position = await client.query<{ position: string }>(
        `SELECT count(*)::text AS position FROM index_jobs
         WHERE workspace_id = $2 AND status = 'queued'
           AND (created_at, id) <= (SELECT created_at, id FROM index_jobs WHERE id = $1)`,
        [id, workspaceId],
      );
      return { id, queuePosition: Number(position.rows[0]?.position ?? 1) };
    });
  };

  const claimNextJob = async (): Promise<{ id: string; workspaceId: WorkspaceId } | null> =>
    transaction(async (client) => {
      const result = await client.query<{ id: string; workspace_id: string }>(
        `SELECT id, workspace_id FROM index_jobs WHERE status = 'queued'
         ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`,
      );
      const job = result.rows[0];
      if (!job) {
        return null;
      }
      await client.query(
        `UPDATE index_jobs SET status = 'running', phase = 'preparing', started_at = now()
         WHERE id = $1`,
        [job.id],
      );
      return { id: job.id, workspaceId: job.workspace_id };
    });

  return { enqueue, claimNextJob };
};

const createJobOperations = (pool: Pool, transaction: Transaction) => {
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
      `SELECT source_label AS "sourceLabel", content
       FROM job_inputs WHERE job_id = $1 ORDER BY ordinal`,
      [jobId],
    );
    return result.rows;
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

  return { fail, getInputs, getJob, recoverInterruptedJobs, setPhase };
};

const getActiveSnapshot = async (
  pool: Pool,
  workspaceId: WorkspaceId,
): Promise<ActiveSnapshot> => {
  const active = await pool.query<{ id: string; namespace: string }>(
    `SELECT v.id, v.namespace FROM active_index a
      JOIN index_versions v ON v.id = a.version_id AND v.workspace_id = a.workspace_id
      WHERE a.workspace_id = $1`,
    [workspaceId],
  );
  const version = active.rows[0] ?? null;
  if (!version) {
    return { workspaceId, version: null, sources: [] };
  }
  const sources = await pool.query<SourceRecord>(
    `SELECT s.id, s.source_label AS "sourceLabel", s.content
     FROM index_version_sources vs JOIN knowledge_sources s ON s.id = vs.source_id
     WHERE vs.version_id = $1 ORDER BY s.created_at, s.id`,
    [version.id],
  );
  return { workspaceId, version, sources: sources.rows };
};

const createQueryLeaseOperations = (pool: Pool, transaction: Transaction) => {
  const acquireActiveVersionLease = async (
    workspaceId: WorkspaceId,
    leaseDurationMs: number,
  ) =>
    transaction(async (client) => {
      const result = await client.query<{ id: string; namespace: string }>(
        `SELECT v.id, v.namespace FROM active_index a
         JOIN index_versions v ON v.id = a.version_id AND v.workspace_id = a.workspace_id
         WHERE a.workspace_id = $1 FOR SHARE OF a, v`,
        [workspaceId],
      );
      const version = result.rows[0];
      if (!version) {
        return null;
      }

      const leaseId = randomUUID();
      await client.query(
        `INSERT INTO version_query_leases (id, version_id, expires_at)
         VALUES ($1, $2, now() + ($3 * interval '1 millisecond'))`,
        [leaseId, version.id, leaseDurationMs],
      );
      return { ...version, workspaceId, leaseId };
    });

  const renewQueryLease = async (leaseId: string, leaseDurationMs: number): Promise<void> => {
    await pool.query(
      `UPDATE version_query_leases SET expires_at = now() + ($2 * interval '1 millisecond')
       WHERE id = $1`,
      [leaseId, leaseDurationMs],
    );
  };

  const releaseQueryLease = async (leaseId: string): Promise<void> => {
    await pool.query('DELETE FROM version_query_leases WHERE id = $1', [leaseId]);
  };

  return { acquireActiveVersionLease, releaseQueryLease, renewQueryLease };
};

const createSnapshotBuildOperations = (pool: Pool, transaction: Transaction) => ({
  beginSnapshot: async (
    jobId: string,
    namespace: string,
    workspaceId: WorkspaceId,
  ): Promise<void> => {
    await pool.query(
      'INSERT INTO building_snapshots (namespace, job_id, workspace_id) VALUES ($1, $2, $3)',
      [namespace, jobId, workspaceId],
    );
  },
  discardSnapshot: async (namespace: string): Promise<void> =>
    transaction(async (client) => {
      await deleteGraphNamespace(client, namespace);
      await client.query('DELETE FROM building_snapshots WHERE namespace = $1', [namespace]);
    }),
});

const createSnapshotPruner = (transaction: Transaction) => async (
  workspaceId: WorkspaceId,
  maxRetainedVersions: number,
): Promise<number> => transaction(async (client) => {
  await client.query('DELETE FROM version_query_leases WHERE expires_at <= now()');
  const staleVersions = await client.query<{ id: string; namespace: string }>(
    `WITH ranked AS (
       SELECT id, row_number() OVER (
         PARTITION BY workspace_id ORDER BY published_at DESC, id DESC
       ) AS position
       FROM index_versions WHERE workspace_id = $2
     ), stale AS (
       SELECT v.id, v.namespace
       FROM index_versions v JOIN ranked r ON r.id = v.id
       WHERE r.position > $1 AND v.workspace_id = $2
         AND NOT EXISTS (
           SELECT 1 FROM active_index a
           WHERE a.workspace_id = $2 AND a.version_id = v.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM version_query_leases l
           WHERE l.version_id = v.id AND l.expires_at > now()
         )
       FOR UPDATE OF v SKIP LOCKED
     )
     SELECT id, namespace FROM stale`,
    [maxRetainedVersions, workspaceId],
  );

  for (const version of staleVersions.rows) {
    await deleteGraphNamespace(client, version.namespace);
    await client.query('DELETE FROM index_versions WHERE id = $1', [version.id]);
  }
  return staleVersions.rowCount ?? 0;
});

const createSnapshotQueries = (pool: Pool, transaction: Transaction) => ({
  ...createQueryLeaseOperations(pool, transaction),
  ...createSnapshotBuildOperations(pool, transaction),
  getActiveSnapshot: (workspaceId: WorkspaceId) => getActiveSnapshot(pool, workspaceId),
  pruneSnapshots: createSnapshotPruner(transaction),
});

export const createStore = (databaseUrl: string) => {
  const pool = new Pool({ connectionString: databaseUrl, max: 10 });
  const transaction = inTransaction(pool);
  const queueOperations = createQueueOperations(pool, transaction);

  return {
    acquireWorkerLock: async () => pool.connect(),
    close: async () => pool.end(),
    ensureGraphSchema: () => ensureGraphSchema(pool),
    migrate: () => migrate(pool),
    ping: async () => pool.query('SELECT 1').then(() => undefined),
    ...queueOperations,
    ...createJobOperations(pool, transaction),
    ...createSnapshotQueries(pool, transaction),
    publish: createPublisher(transaction),
  };
};

export type IndexStore = ReturnType<typeof createStore>;