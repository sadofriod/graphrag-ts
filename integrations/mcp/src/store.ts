import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool, type PoolClient } from 'pg';
import { fileURLToPath } from 'node:url';
import type { JobInput } from './input.ts';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export type JobRecord = {
  readonly id: string;
  readonly status: JobStatus;
  readonly phase: string | null;
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly errorCode: string | null;
  readonly errorSummary: string | null;
  readonly publishedVersion: { readonly id: string; readonly namespace: string } | null;
};

export type SourceRecord = {
  readonly id: string;
  readonly sourceLabel: string;
  readonly content: string;
};

export type BuildSource = Pick<SourceRecord, 'sourceLabel' | 'content'>;

export type ActiveSnapshot = {
  readonly version: { readonly id: string; readonly namespace: string } | null;
  readonly sources: readonly SourceRecord[];
};

type DatabaseJob = {
  id: string;
  status: JobStatus;
  phase: string | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  error_code: string | null;
  error_summary: string | null;
  version_id: string | null;
  namespace: string | null;
};

const asJobRecord = (row: DatabaseJob): JobRecord => ({
  id: row.id,
  status: row.status,
  phase: row.phase,
  createdAt: row.created_at,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  errorCode: row.error_code,
  errorSummary: row.error_summary,
  publishedVersion:
    row.version_id && row.namespace
      ? { id: row.version_id, namespace: row.namespace }
      : null,
});

type Transaction = <Result>(operation: (client: PoolClient) => Promise<Result>) => Promise<Result>;

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
  for (const migration of ['001_init.sql', '002_hierarchical_communities.sql']) {
    const migrationPath = fileURLToPath(new URL(`../migrations/${migration}`, import.meta.url));
    await pool.query(await readFile(migrationPath, 'utf8'));
  }
};

const createQueueOperations = (pool: Pool, transaction: Transaction) => {
  const enqueue = async (inputs: readonly JobInput[]): Promise<{ id: string; queuePosition: number }> => {
    const id = randomUUID();
    return transaction(async (client) => {
      await client.query('INSERT INTO index_jobs (id, status, phase) VALUES ($1, $2, $3)', [id, 'queued', 'queued']);
      for (const [ordinal, input] of inputs.entries()) {
        await client.query(
          `INSERT INTO job_inputs (job_id, ordinal, source_label, content, content_hash, media_type)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, ordinal, input.sourceLabel, input.content, input.contentHash, input.mediaType],
        );
      }
      const position = await client.query<{ position: string }>(
        `SELECT count(*)::text AS position FROM index_jobs
         WHERE status = 'queued' AND (created_at, id) <= (SELECT created_at, id FROM index_jobs WHERE id = $1)`,
        [id],
      );
      return { id, queuePosition: Number(position.rows[0]?.position ?? 1) };
    });
  };

  const claimNextJob = async (): Promise<{ id: string } | null> =>
    transaction(async (client) => {
      const result = await client.query<{ id: string }>(
        `SELECT id FROM index_jobs WHERE status = 'queued'
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
      return job;
    });

  return { enqueue, claimNextJob };
};

const createJobOperations = (pool: Pool) => {
  const getJob = async (id: string): Promise<JobRecord | null> => {
    const result = await pool.query<DatabaseJob>(
      `SELECT j.id, j.status, j.phase, j.created_at, j.started_at, j.finished_at,
              j.error_code, j.error_summary, v.id AS version_id, v.namespace
       FROM index_jobs j LEFT JOIN index_versions v ON v.id = j.published_version_id
       WHERE j.id = $1`,
      [id],
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
    await pool.query(
      `UPDATE index_jobs SET status = 'failed', phase = 'failed', finished_at = now(),
       error_code = 'WORKER_RESTARTED', error_summary = 'Worker stopped before this job completed.'
       WHERE status = 'running'`,
    );
  };

  const setPhase = async (jobId: string, phase: string): Promise<void> => {
    await pool.query(
      `UPDATE index_jobs SET phase = $2 WHERE id = $1 AND status = 'running'`,
      [jobId, phase],
    );
  };

  return { fail, getInputs, getJob, recoverInterruptedJobs, setPhase };
};

const createSnapshotQueries = (pool: Pool) => {
  const getActiveSnapshot = async (): Promise<ActiveSnapshot> => {
    const active = await pool.query<{ id: string; namespace: string }>(
      `SELECT v.id, v.namespace FROM active_index a
       JOIN index_versions v ON v.id = a.version_id WHERE a.singleton = true`,
    );
    const version = active.rows[0] ?? null;
    if (!version) {
      return { version: null, sources: [] };
    }
    const sources = await pool.query<SourceRecord>(
      `SELECT s.id, s.source_label AS "sourceLabel", s.content
       FROM index_version_sources vs JOIN knowledge_sources s ON s.id = vs.source_id
       WHERE vs.version_id = $1 ORDER BY s.created_at, s.id`,
      [version.id],
    );
    return { version, sources: sources.rows };
  };

  const getActiveVersion = async (): Promise<ActiveSnapshot['version']> => {
    const result = await pool.query<{ id: string; namespace: string }>(
      `SELECT v.id, v.namespace FROM active_index a
       JOIN index_versions v ON v.id = a.version_id WHERE a.singleton = true`,
    );
    return result.rows[0] ?? null;
  };

  return { getActiveSnapshot, getActiveVersion };
};

const createPublisher = (pool: Pool, transaction: Transaction) => async (
  jobId: string,
  versionId: string,
  namespace: string,
  previousSourceIds: readonly string[],
): Promise<void> => {
  await transaction(async (client) => {
    const job = await client.query<{ status: JobStatus }>(
      'SELECT status FROM index_jobs WHERE id = $1 FOR UPDATE',
      [jobId],
    );
    if (job.rows[0]?.status !== 'running') {
      throw new Error('Index job is no longer running.');
    }
    await client.query(
      'INSERT INTO index_versions (id, namespace, created_by_job_id) VALUES ($1, $2, $3)',
      [versionId, namespace, jobId],
    );

    const inputs = await client.query<{
      source_label: string;
      content: string;
      content_hash: string;
    }>(
      `SELECT source_label, content, content_hash FROM job_inputs
       WHERE job_id = $1 ORDER BY ordinal`,
      [jobId],
    );
    const newSourceIds: string[] = [];
    for (const input of inputs.rows) {
      const sourceId = randomUUID();
      newSourceIds.push(sourceId);
      await client.query(
        `INSERT INTO knowledge_sources (id, created_by_job_id, source_label, content, content_hash)
         VALUES ($1, $2, $3, $4, $5)`,
        [sourceId, jobId, input.source_label, input.content, input.content_hash],
      );
    }
    for (const sourceId of [...previousSourceIds, ...newSourceIds]) {
      await client.query(
        'INSERT INTO index_version_sources (version_id, source_id) VALUES ($1, $2)',
        [versionId, sourceId],
      );
    }
    await client.query(
      `INSERT INTO active_index (singleton, version_id) VALUES (true, $1)
       ON CONFLICT (singleton) DO UPDATE SET version_id = EXCLUDED.version_id, updated_at = now()`,
      [versionId],
    );
    await client.query(
      `UPDATE index_jobs SET status = 'succeeded', phase = 'published',
       finished_at = now(), published_version_id = $2 WHERE id = $1`,
      [jobId, versionId],
    );
  });
};

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
    ...createJobOperations(pool),
    ...createSnapshotQueries(pool),
    publish: createPublisher(pool, transaction),
  };
};

export type IndexStore = ReturnType<typeof createStore>;