import { randomUUID } from 'node:crypto';
import { retrieve, retrieveGlobal } from './graph-rag.ts';
import type { Logger } from './log.ts';
import type { AppConfig } from './config.ts';
import type { IndexStore } from './store.ts';
import { createActivityLogger } from './mcp/queryActivity.ts';

export type RetrievalResult = Awaited<ReturnType<typeof retrieve>>;
export type GlobalRetrievalResult = Awaited<ReturnType<typeof retrieveGlobal>>;
type QueryResult = RetrievalResult | GlobalRetrievalResult;

export class QueryServiceError extends Error {
  readonly code: 'INDEX_NOT_READY' | 'QUERY_TIMEOUT' | 'QUERY_FAILED';
  override readonly cause?: unknown;
  readonly completion?: Promise<void>;

  constructor(code: 'INDEX_NOT_READY' | 'QUERY_TIMEOUT' | 'QUERY_FAILED', message: string, cause?: unknown, completion?: Promise<void>) {
    super(message);
    this.name = 'QueryServiceError';
    this.code = code;
    if (cause !== undefined) this.cause = cause;
    if (completion !== undefined) this.completion = completion;
  }
}

type QueryDeps = { store: IndexStore; config: AppConfig; logger: Logger };
type QueryParams = {
  workspaceId: string; query: string; mode: 'local' | 'global'; maxResults: number;
  communityLevel?: number | 'leaf'; operationId?: string;
};
type Lease = NonNullable<Awaited<ReturnType<IndexStore['acquireActiveVersionLease']>>>;
type ActivityLogger = ReturnType<typeof createActivityLogger>;

const acquireSnapshotLease = async (
  store: IndexStore,
  logActivity: ActivityLogger,
  workspaceId: string,
  mode: 'local' | 'global',
  query: string,
  communityLevel: number | 'leaf' | undefined,
  leaseDurationMs: number,
): Promise<Lease> => {
  await logActivity('info', 'Retrieval started.', { mode, query_length: query.length, community_level: communityLevel ?? null });
  const lease = await store.acquireActiveVersionLease(workspaceId, leaseDurationMs);
  if (lease) return lease;
  await logActivity('warn', 'Retrieval unavailable: no index is published.', { mode });
  throw new QueryServiceError('INDEX_NOT_READY', 'No index is published yet.');
};

const startRetrieval = (
  deps: QueryDeps,
  params: QueryParams,
  lease: Lease,
  leaseDurationMs: number,
): { work: Promise<QueryResult>; renewal: ReturnType<typeof setInterval>; controller: AbortController } => {
  const { store, logger } = deps;
  const controller = new AbortController();
  const renewal = setInterval(() => {
    void store.renewQueryLease(lease.leaseId, leaseDurationMs).catch((error: unknown) => {
      logger.warn('Could not renew active query snapshot lease.', {
        error_name: error instanceof Error ? error.name : 'UnknownError',
      });
    });
  }, Math.max(1_000, Math.floor(leaseDurationMs / 3)));
  const { query, mode, maxResults, communityLevel } = params;
  const work = mode === 'global'
    ? retrieveGlobal(query, lease.namespace, communityLevel, controller.signal)
    : retrieve(query, lease.namespace, maxResults, communityLevel === 'leaf' ? undefined : communityLevel, controller.signal);
  return { work, renewal, controller };
};

const raceWithTimeout = (
  work: Promise<QueryResult>,
  timeoutMs: number,
  controller: AbortController,
): { result: Promise<QueryResult>; getHandle: () => ReturnType<typeof setTimeout> | undefined; didTimeout: () => boolean } => {
  let handle: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeout = new Promise<never>((_resolve, reject) => {
    handle = setTimeout(() => {
      timedOut = true;
      const completion = work.then(() => undefined, () => undefined);
      const error = new QueryServiceError('QUERY_TIMEOUT', 'The GraphRAG query exceeded its configured time limit.', undefined, completion);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  return { result: Promise.race([work, timeout]), getHandle: () => handle, didTimeout: () => timedOut };
};

const mapQueryError = async (
  error: unknown,
  timedOut: boolean,
  mode: 'local' | 'global',
  startedAt: number,
  logActivity: ActivityLogger,
  logger: Logger,
): Promise<never> => {
  if (error instanceof QueryServiceError && error.code === 'INDEX_NOT_READY') throw error;
  if (error instanceof QueryServiceError && error.code === 'QUERY_TIMEOUT') {
    await logActivity('error', 'Retrieval failed.', { mode, code: 'QUERY_TIMEOUT', duration_ms: Date.now() - startedAt });
    throw error;
  }
  if (!(error instanceof QueryServiceError) && timedOut) {
    throw new QueryServiceError('QUERY_TIMEOUT', 'The GraphRAG query exceeded its configured time limit.', error);
  }
  await logActivity('error', 'Retrieval failed.', { mode, code: 'UPSTREAM_ERROR', duration_ms: Date.now() - startedAt });
  logger.error('MCP tool failed.', {
    tool: mode === 'global' ? 'query_graph_global' : 'query_graph',
    error_name: error instanceof QueryServiceError ? 'UnknownError' : error instanceof Error ? error.name : 'UnknownError',
  });
  throw new QueryServiceError('QUERY_FAILED', 'GraphRAG retrieval failed.', error);
};

const releaseSnapshotLease = async (
  store: IndexStore,
  lease: Lease,
  renewal: ReturnType<typeof setInterval>,
  logger: Logger,
): Promise<void> => {
  clearInterval(renewal);
  await store.releaseQueryLease(lease.leaseId).catch((error: unknown) => {
    logger.warn('Could not release active query snapshot lease.', {
      error_name: error instanceof Error ? error.name : 'UnknownError',
    });
  });
};

const cleanupQuery = async (
  store: IndexStore,
  lease: Lease | undefined,
  retrieval: ReturnType<typeof startRetrieval> | undefined,
  timeout: ReturnType<typeof raceWithTimeout> | undefined,
  logger: Logger,
): Promise<void> => {
  const timeoutHandle = timeout?.getHandle();
  if (timeoutHandle) clearTimeout(timeoutHandle);
  if (!lease || !retrieval) return;
  const cleanup = () => releaseSnapshotLease(store, lease, retrieval.renewal, logger);
  // Keep the snapshot leased and renewed until an aborted retrieval actually stops.
  if (timeout?.didTimeout()) void retrieval.work.then(cleanup, cleanup);
  else await cleanup();
};

export const runSnapshotQuery = async (
  deps: QueryDeps,
  params: QueryParams,
): Promise<{
  result: QueryResult;
  version: { id: string; workspaceId: string };
  durationMs: number;
  leaseId: string;
}> => {
  const { store, config, logger } = deps;
  const { workspaceId, query, mode } = params;
  const communityLevel = params.communityLevel;
  const operationId = params.operationId ?? randomUUID();
  const startedAt = Date.now();
  const logActivity = createActivityLogger(store, logger, workspaceId, operationId);
  const leaseDurationMs = Math.max(config.QUERY_TIMEOUT_MS * 2, 60_000);
  let lease: Lease | undefined;
  let retrieval: ReturnType<typeof startRetrieval> | undefined;
  let timeout: ReturnType<typeof raceWithTimeout> | undefined;
  try {
    lease = await acquireSnapshotLease(store, logActivity, workspaceId, mode, query, communityLevel, leaseDurationMs);
    retrieval = startRetrieval(deps, params, lease, leaseDurationMs);
    timeout = raceWithTimeout(retrieval.work, config.QUERY_TIMEOUT_MS, retrieval.controller);
    const result = await timeout.result;
    const durationMs = Date.now() - startedAt;
    await logActivity('info', 'Retrieval completed.', { mode, duration_ms: durationMs });
    return { result, version: { id: lease.id, workspaceId: lease.workspaceId }, durationMs, leaseId: lease.leaseId };
  } catch (error) {
    return await mapQueryError(error, timeout?.didTimeout() ?? false, mode, startedAt, logActivity, logger);
  } finally {
    await cleanupQuery(store, lease, retrieval, timeout, logger);
  }
};
