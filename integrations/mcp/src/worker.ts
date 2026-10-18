import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { AppConfig } from './config.ts';
import { buildSnapshot } from './graph-rag.ts';
import type { Logger } from './log.ts';
import type { BuildSource, IndexStore } from './store.ts';
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
  sources.map((source) => ({ title: source.sourceLabel, content: source.content }));

const processJob = async (
  jobId: string,
  workspaceId: WorkspaceId,
  store: IndexStore,
  config: AppConfig,
  logger: Logger,
): Promise<void> => {
  let namespace: string | undefined;
  const recordLog = async (
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
  const recordPhase = async (phase: string, details: Record<string, unknown> = {}): Promise<void> => {
    await store.setPhase(jobId, phase);
    await recordLog(`Build ${phase}.`, details);
  };
  try {
    await recordPhase('preparing');
    const [active, inputs] = await Promise.all([
      store.getActiveSnapshot(workspaceId),
      store.getInputs(jobId),
    ]);
    await recordLog('Build inputs loaded.', { input_count: inputs.length, existing_source_count: active.sources.length });
    namespace = `snapshot-${randomUUID()}`;
    const versionId = randomUUID();
    await store.beginSnapshot(jobId, namespace, workspaceId);
    await recordPhase('building');
    await buildSnapshot(buildInputFiles([...active.sources, ...inputs]), namespace);
    await recordPhase('publishing');
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
    await recordLog('Index published.', { version_id: versionId });
    logger.info('Index job published.', { job_id: jobId, version_id: versionId });
  } catch (error) {
    const summary = errorSummary(error);
    await store.fail(jobId, 'BUILD_FAILED', summary);
    await recordLog('Build failed.', { code: 'BUILD_FAILED', summary }, 'error');
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
      await processJob(job.id, job.workspaceId, store, config, logger);
    }
  } finally {
    await lockClient.query('SELECT pg_advisory_unlock(739284729384::bigint)').catch(() => undefined);
    lockClient.release();
  }
};

const storePoolConnection = async (store: IndexStore) => store.acquireWorkerLock();