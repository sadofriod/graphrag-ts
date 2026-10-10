import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { AppConfig } from './config.ts';
import { buildSnapshot } from './graph-rag.ts';
import type { Logger } from './log.ts';
import type { BuildSource, IndexStore } from './store.ts';

const errorSummary = (error: unknown): string => {
  const message = error instanceof Error ? error.message : 'Unknown build error.';
  return message
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
    .replace(/(api[_-]?key\s*[=:]\s*)\S+/gi, '$1[REDACTED]')
    .slice(0, 500);
};

const buildInputFiles = (sources: readonly BuildSource[]) =>
  sources.map((source) => ({ title: source.sourceLabel, content: source.content }));

const processJob = async (
  jobId: string,
  store: IndexStore,
  config: AppConfig,
  logger: Logger,
): Promise<void> => {
  let namespace: string | undefined;
  try {
    await store.setPhase(jobId, 'preparing');
    const [active, inputs] = await Promise.all([
      store.getActiveSnapshot(),
      store.getInputs(jobId),
    ]);
    namespace = `snapshot-${randomUUID()}`;
    const versionId = randomUUID();
    await store.beginSnapshot(jobId, namespace);
    await store.setPhase(jobId, 'building');
    await buildSnapshot(buildInputFiles([...active.sources, ...inputs]), namespace);
    await store.setPhase(jobId, 'publishing');
    await store.publish(jobId, versionId, namespace, active.sources.map((source) => source.id));
    try {
      const removedVersions = await store.pruneSnapshots(config.MAX_RETAINED_VERSIONS);
      if (removedVersions > 0) {
        logger.info('Expired GraphRAG snapshots removed.', { count: removedVersions });
      }
    } catch (error) {
      logger.warn('Snapshot retention cleanup failed.', {
        error_name: error instanceof Error ? error.name : 'UnknownError',
      });
    }
    logger.info('Index job published.', { job_id: jobId, version_id: versionId });
  } catch (error) {
    const summary = errorSummary(error);
    await store.fail(jobId, 'BUILD_FAILED', summary);
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

    await store.recoverInterruptedJobs();
    logger.info('Index worker started.');
    while (!signal.aborted) {
      const job = await store.claimNextJob();
      if (!job) {
        await delay(config.QUEUE_POLL_MS, undefined, { signal }).catch(() => undefined);
        continue;
      }

      logger.info('Index job claimed.', { job_id: job.id });
      await processJob(job.id, store, config, logger);
    }
  } finally {
    await lockClient.query('SELECT pg_advisory_unlock(739284729384::bigint)').catch(() => undefined);
    lockClient.release();
  }
};

const storePoolConnection = async (store: IndexStore) => store.acquireWorkerLock();