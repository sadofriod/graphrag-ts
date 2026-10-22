import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { AppConfig } from './config.ts';
import { buildSnapshot } from './graph-rag.ts';
import type { Logger } from './log.ts';
import type { BuildSource, IndexStore } from './store.ts';
import { encodeSourceTitle, resolveSnapshotSources } from './snapshotSources.ts';
import type { WorkspaceId } from './workspace.ts';

const errorSummary = (error: unknown): string => {
  const message = error instanceof Error ? error.message : 'Unknown build error.';
  return message
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
    .replace(/(api[_-]?key\s*[=:]\s*)\S+/gi, '$1[REDACTED]')
    .slice(0, 500);
};

const buildInputFiles = (sources: readonly BuildSource[]) =>
  sources.map((source) => ({
    title: encodeSourceTitle(source.sourceLabel),
    content: source.content,
  }));

const recordBuildLog = async (
  store: IndexStore,
  logger: Logger,
  workspaceId: WorkspaceId,
  jobId: string,
  message: string,
  details: Record<string, unknown> = {},
  level: 'info' | 'error' = 'info',
): Promise<void> => {
  await store.appendActivityLog({
    workspaceId,
    operationId: jobId,
    jobId,
    kind: 'build',
    level,
    message,
    details,
  }).catch((error: unknown) => {
    logger.warn('Could not persist build activity.', {
      job_id: jobId,
      error_name: error instanceof Error ? error.name : 'UnknownError',
    });
  });
};

const recordBuildPhase = async (
  store: IndexStore,
  logger: Logger,
  workspaceId: WorkspaceId,
  jobId: string,
  phase: string,
  details: Record<string, unknown> = {},
): Promise<void> => {
  await store.setPhase(jobId, phase);
  await recordBuildLog(store, logger, workspaceId, jobId, `Build ${phase}.`, details);
};

const processJob = async (
  jobId: string,
  workspaceId: WorkspaceId,
  store: IndexStore,
  config: AppConfig,
  logger: Logger,
): Promise<void> => {
  let namespace: string | undefined;
  try {
    await recordBuildPhase(store, logger, workspaceId, jobId, 'preparing');
    const [active, inputs] = await Promise.all([
      store.getActiveSnapshot(workspaceId),
      store.getInputs(jobId),
    ]);
    await recordBuildLog(store, logger, workspaceId, jobId, 'Build inputs loaded.', {
      input_count: inputs.length,
      existing_source_count: active.sources.length,
    });
    namespace = `snapshot-${randomUUID()}`;
    const versionId = randomUUID();
    await store.beginSnapshot(jobId, namespace, workspaceId);
    await store.cloneSnapshot(active.version?.namespace ?? null, namespace);
    await recordBuildPhase(store, logger, workspaceId, jobId, 'building');
    const { changed } = resolveSnapshotSources(active.sources, inputs);
    await buildSnapshot(buildInputFiles(changed), namespace, true);
    await recordBuildPhase(store, logger, workspaceId, jobId, 'publishing');
    await store.publish(
      jobId,
      versionId,
      namespace,
      workspaceId,
      active.sources.map((source) => source.id),
    );
    try {
      const removedVersions = await store.pruneSnapshots(workspaceId, config.MAX_RETAINED_VERSIONS);
      if (removedVersions > 0) {
        logger.info('Expired GraphRAG snapshots removed.', { count: removedVersions });
      }
    } catch (error) {
      logger.warn('Snapshot retention cleanup failed.', {
        error_name: error instanceof Error ? error.name : 'UnknownError',
      });
    }
    await recordBuildLog(store, logger, workspaceId, jobId, 'Index published.', { version_id: versionId });
    logger.info('Index job published.', { job_id: jobId, version_id: versionId });
  } catch (error) {
    const summary = errorSummary(error);
    await store.fail(jobId, 'BUILD_FAILED', summary);
    await recordBuildLog(store, logger, workspaceId, jobId, 'Build failed.', {
      code: 'BUILD_FAILED',
      summary,
    }, 'error');
    if (namespace) {
      await store.discardSnapshot(namespace).catch((cleanupError: unknown) => {
        logger.warn('Failed GraphRAG snapshot cleanup failed.', {
          job_id: jobId,
          error_name: cleanupError instanceof Error ? cleanupError.name : 'UnknownError',
        });
      });
    }
    logger.error('Index job failed.', { job_id: jobId, summary });
  }
};

const processQueuedJobs = async (
  store: IndexStore,
  config: AppConfig,
  logger: Logger,
  signal: AbortSignal,
): Promise<void> => {
  await store.recoverInterruptedJobs();
  logger.info('Index worker started.');
  while (!signal.aborted) {
    const job = await store.claimNextJob();
    if (!job) {
      await delay(config.QUEUE_POLL_MS, undefined, { signal }).catch(() => undefined);
      continue;
    }
    logger.info('Index job claimed.', { job_id: job.id });
    await processJob(job.id, job.workspaceId, store, config, logger);
  }
};

export const runWorker = async (
  store: IndexStore,
  config: AppConfig,
  logger: Logger,
  signal: AbortSignal,
): Promise<void> => {
  const lockClient = await storePoolConnection(store);
  try {
    const lock = await lockClient.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock(739284729384::bigint) AS locked',
    );
    if (!lock.rows[0]?.locked) {
      throw new Error('Worker lock is already held; refusing concurrent GraphRAG builds.');
    }

    await processQueuedJobs(store, config, logger, signal);
  } finally {
    await lockClient.query('SELECT pg_advisory_unlock(739284729384::bigint)').catch(() => undefined);
    lockClient.release();
  }
};

const storePoolConnection = async (store: IndexStore) => store.acquireWorkerLock();