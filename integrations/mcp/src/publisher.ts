import { randomUUID } from 'node:crypto';
import type { SourceRecord, Transaction } from './store.ts';
import { resolveSnapshotSources } from './snapshotSources.ts';
import type { WorkspaceId } from './workspace.ts';

export const createPublisher = (transaction: Transaction) => async (
  jobId: string,
  versionId: string,
  namespace: string,
  workspaceId: WorkspaceId,
  previousSourceIds: readonly string[],
): Promise<void> => {
  await transaction(async (client) => {
    const job = await client.query<{ status: string; workspace_id: string }>(
      'SELECT status, workspace_id FROM index_jobs WHERE id = $1 FOR UPDATE',
      [jobId],
    );
    if (job.rows[0]?.status !== 'running' || job.rows[0]?.workspace_id !== workspaceId) {
      throw new Error('Index job is no longer running.');
    }
    await client.query(
      'INSERT INTO index_versions (id, namespace, workspace_id, created_by_job_id) VALUES ($1, $2, $3, $4)',
      [versionId, namespace, workspaceId, jobId],
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
    const previous = await client.query<SourceRecord>(
      `SELECT id, source_label AS "sourceLabel", content, content_hash AS "contentHash"
       FROM knowledge_sources WHERE id = ANY($1::text[]) ORDER BY created_at, id`,
      [previousSourceIds],
    );
    const { sources } = resolveSnapshotSources(previous.rows, inputs.rows.map((input) => ({
      sourceLabel: input.source_label, content: input.content, contentHash: input.content_hash,
    })));
    for (const source of sources) {
      const sourceId = source.id ?? randomUUID();
      if (!source.id) {
        await client.query(
          `INSERT INTO knowledge_sources (id, created_by_job_id, source_label, content, content_hash)
           VALUES ($1, $2, $3, $4, $5)`,
          [sourceId, jobId, source.sourceLabel, source.content, source.contentHash],
        );
      }
      await client.query(
        'INSERT INTO index_version_sources (version_id, source_id) VALUES ($1, $2)',
        [versionId, sourceId],
      );
    }
    await client.query(
      `INSERT INTO active_index (workspace_id, version_id) VALUES ($1, $2)
       ON CONFLICT (workspace_id) DO UPDATE SET version_id = EXCLUDED.version_id, updated_at = now()`,
      [workspaceId, versionId],
    );
    await client.query(
      `UPDATE index_jobs SET status = 'succeeded', phase = 'published',
       finished_at = now(), published_version_id = $3 WHERE id = $1 AND workspace_id = $2`,
      [jobId, workspaceId, versionId],
    );
    await client.query('DELETE FROM building_snapshots WHERE namespace = $1', [namespace]);
  });
};