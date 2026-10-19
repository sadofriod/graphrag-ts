import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AppConfig } from '../config.ts';
import { retrieve, retrieveGlobal } from '../graph-rag.ts';
import { InputError, normalizeSourceLabel, pathInputs, textInput } from '../input.ts';
import { formatGlobalQueryOutput, formatQueryOutput } from '../output.ts';
import type { Logger } from '../log.ts';
import type { IndexStore } from '../store.ts';
import { workspaceIdSchema } from '../workspace.ts';
import { createActivityLogger } from './queryActivity.ts';

class ToolError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const toolErrorResult = (code: string, message: string) => ({
  content: [{ type: 'text' as const, text: JSON.stringify({ error: { code, message } }) }],
  isError: true,
});

const inputFailure = (error: unknown, logger: Logger, tool: string) => {
  if (error instanceof InputError) {
    return toolErrorResult(error.code, error.message);
  }
  logger.error('MCP tool failed.', {
    tool,
    error_name: error instanceof Error ? error.name : 'UnknownError',
  });
  return toolErrorResult('INTERNAL_ERROR', 'The operation failed. Check the server logs for details.');
};

type ToolContext = {
  readonly store: IndexStore;
  readonly config: AppConfig;
  readonly logger: Logger;
};

type QueryResult = Awaited<ReturnType<typeof retrieve>> | Awaited<ReturnType<typeof retrieveGlobal>>;

type QueryOutcome =
  | { readonly status: 'completed'; readonly result: QueryResult }
  | { readonly status: 'failed'; readonly error: unknown };

type QueryLease = NonNullable<Awaited<ReturnType<IndexStore['acquireActiveVersionLease']>>>;

export const createQueryLimiter = (limit: number) => {
  let activeQueries = 0;
  return {
    tryAcquire: (): (() => void) | undefined => {
      if (activeQueries >= limit) {
        return undefined;
      }
      activeQueries += 1;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          activeQueries -= 1;
        }
      };
    },
  };
};

export const communityLevelSchema = z.number().int().min(0).optional();

export const globalCommunityLevelSchema = z.union([
  z.number().int().min(0),
  z.literal('leaf'),
]).optional();

const startRetrieval = (
  query: string,
  mode: 'local' | 'global',
  maxResults: number,
  communityLevel: number | 'leaf' | undefined,
  lease: QueryLease,
  signal: AbortSignal,
): Promise<QueryOutcome> => {
  const retrieval = mode === 'global'
    ? retrieveGlobal(query, lease.namespace, communityLevel, signal)
    : retrieve(query, lease.namespace, maxResults, communityLevel === 'leaf' ? undefined : communityLevel, signal);
  return retrieval.then(
    (result): QueryOutcome => ({ status: 'completed', result }),
    (error: unknown): QueryOutcome => ({ status: 'failed', error }),
  );
};

const renewLeaseWhileQuerying = (
  store: IndexStore,
  logger: Logger,
  leaseId: string,
  leaseDurationMs: number,
): ReturnType<typeof setInterval> => setInterval(() => {
  void store.renewQueryLease(leaseId, leaseDurationMs).catch((error: unknown) => {
    logger.warn('Could not renew active query snapshot lease.', {
      error_name: error instanceof Error ? error.name : 'UnknownError',
    });
  });
}, Math.max(1_000, Math.floor(leaseDurationMs / 3)));

const formatQueryOutcome = (
  outcome: QueryOutcome,
  lease: QueryLease,
  maxOutputChars: number,
) => {
  if (outcome.status === 'failed') {
    throw outcome.error;
  }
  if ('communityLevel' in outcome.result) {
    return {
      content: [{
        type: 'text' as const,
        text: formatGlobalQueryOutput(outcome.result, lease, maxOutputChars),
      }],
    };
  }
  if ('communities' in outcome.result) {
    return {
      content: [{
        type: 'text' as const,
        text: formatQueryOutput(outcome.result, lease, maxOutputChars),
      }],
    };
  }
  return toolErrorResult('INTERNAL_ERROR', 'GraphRAG returned an unexpected result shape.');
};

const handleQueryFailure = async (
  error: unknown,
  mode: 'local' | 'global',
  startedAt: number,
  logActivity: ReturnType<typeof createActivityLogger>,
  logger: Logger,
) => {
  const duration = Date.now() - startedAt;
  if (error instanceof ToolError) {
    await logActivity('error', 'Retrieval failed.', { mode, code: error.code, duration_ms: duration });
    return toolErrorResult(error.code, error.message);
  }
  await logActivity('error', 'Retrieval failed.', { mode, code: 'UPSTREAM_ERROR', duration_ms: duration });
  logger.error('MCP tool failed.', {
    tool: mode === 'global' ? 'query_graph_global' : 'query_graph',
    error_name: error instanceof Error ? error.name : 'UnknownError',
  });
  return toolErrorResult('UPSTREAM_ERROR', 'GraphRAG retrieval failed. Check the configured model service and server logs.');
};

const executeQuery = async (
  { store, config, logger }: ToolContext,
  workspaceId: string,
  query: string,
  mode: 'local' | 'global',
  maxResults: number,
  communityLevel: number | 'leaf' | undefined,
  releaseQuerySlot: () => void,
) => {
  const operationId = randomUUID();
  const startedAt = Date.now();
  const logActivity = createActivityLogger(store, logger, workspaceId, operationId);
  let lease: QueryLease | null = null;
  let workStarted = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let leaseRenewalHandle: ReturnType<typeof setInterval> | undefined;
  const leaseDurationMs = Math.max(config.QUERY_TIMEOUT_MS * 2, 60_000);

  try {
    await logActivity('info', 'Retrieval started.', {
      mode,
      query_length: query.length,
      community_level: communityLevel ?? null,
    });
    lease = await store.acquireActiveVersionLease(workspaceId, leaseDurationMs);
    if (!lease) {
      await logActivity('warn', 'Retrieval unavailable: no index is published.', { mode });
      return toolErrorResult('INDEX_NOT_READY', 'No index is published yet. Submit an indexing job and check its status.');
    }
    const activeLease = lease;
    const abortController = new AbortController();
    leaseRenewalHandle = renewLeaseWhileQuerying(store, logger, activeLease.leaseId, leaseDurationMs);
    const work = startRetrieval(query, mode, maxResults, communityLevel, activeLease, abortController.signal)
      .finally(async () => {
        if (leaseRenewalHandle) {
          clearInterval(leaseRenewalHandle);
        }
        await store.releaseQueryLease(activeLease.leaseId).catch((error: unknown) => {
          logger.warn('Could not release active query snapshot lease.', {
            error_name: error instanceof Error ? error.name : 'UnknownError',
          });
        });
        releaseQuerySlot();
      });
    workStarted = true;
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        const error = new ToolError('QUERY_TIMEOUT', 'The GraphRAG query exceeded its configured time limit.');
        abortController.abort(error);
        reject(error);
      }, config.QUERY_TIMEOUT_MS);
    });
    const outcome = await Promise.race([work, timeout]);
    const formatted = formatQueryOutcome(outcome, activeLease, config.MAX_OUTPUT_CHARS);
    await logActivity('info', 'Retrieval completed.', { mode, duration_ms: Date.now() - startedAt });
    return formatted;
  } catch (error) {
    return handleQueryFailure(error, mode, startedAt, logActivity, logger);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    if (!workStarted) {
      if (lease) {
        await store.releaseQueryLease(lease.leaseId).catch(() => undefined);
      }
      releaseQuerySlot();
    }
  }
};

const createQuerySnapshot = (
  context: ToolContext,
  queryLimiter: ReturnType<typeof createQueryLimiter>,
) => {
  return async (
    workspaceId: string,
    query: string,
    mode: 'local' | 'global',
    maxResults: number,
    communityLevel?: number | 'leaf',
  ) => {
    const releaseQuerySlot = queryLimiter.tryAcquire();
    if (!releaseQuerySlot) {
      return toolErrorResult('QUERY_CAPACITY', 'The server has reached its active query limit. Try again shortly.');
    }
    return executeQuery(context, workspaceId, query, mode, maxResults, communityLevel, releaseQuerySlot);
  };
};

const registerPathInputTool = (server: McpServer, { store, config, logger }: ToolContext): void => {
  server.registerTool(
    'submit_index_job',
    {
      description: 'Queue Markdown files from the configured read-only input directory in a workspace for indexing. Defaults to workspace "default".',
      inputSchema: {
        workspace_id: workspaceIdSchema,
        path: z.string().min(1).max(1024),
        source: z.string().max(200).optional(),
      },
    },
    async ({ workspace_id, path, source }) => {
      try {
        const inputs = await pathInputs(path, config);
        const job = await store.enqueue(
          source
            ? inputs.map((input) => ({
                ...input,
                sourceLabel: normalizeSourceLabel(`${source}/${input.sourceLabel}`),
              }))
            : inputs,
          workspace_id,
        );
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              job_id: job.id,
              workspace_id,
              status: 'queued',
              queue_position: job.queuePosition,
            }),
          }],
        };
      } catch (error) {
        return inputFailure(error, logger, 'submit_index_job');
      }
    },
  );
};

const registerTextInputTool = (server: McpServer, { store, config, logger }: ToolContext): void => {
  server.registerTool(
    'remember_text',
    {
      description: 'Explicitly queue user-provided text in a workspace; this tool does not read chat history. Defaults to workspace "default".',
      inputSchema: {
        workspace_id: workspaceIdSchema,
        text: z.string().min(1),
        source: z.string().max(200).optional(),
      },
    },
    async ({ workspace_id, text, source }) => {
      try {
        const job = await store.enqueue(textInput(text, source, config), workspace_id);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              job_id: job.id,
              workspace_id,
              status: 'queued',
              queue_position: job.queuePosition,
            }),
          }],
        };
      } catch (error) {
        return inputFailure(error, logger, 'remember_text');
      }
    },
  );
};

const registerJobTool = (server: McpServer, { store, logger }: ToolContext): void => {
  server.registerTool(
    'get_index_job',
    {
      description: 'Get the status and safe error summary for a job in a workspace.',
      inputSchema: {
        workspace_id: workspaceIdSchema,
        job_id: z.string().uuid(),
      },
    },
    async ({ workspace_id, job_id }) => {
      try {
        const job = await store.getJob(job_id, workspace_id);
        if (!job) {
          return toolErrorResult('JOB_NOT_FOUND', 'No indexing job exists with that ID.');
        }
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              job_id: job.id,
              workspace_id: job.workspaceId,
              status: job.status,
              phase: job.phase,
              created_at: job.createdAt.toISOString(),
              started_at: job.startedAt?.toISOString() ?? null,
              finished_at: job.finishedAt?.toISOString() ?? null,
              error: job.errorCode ? { code: job.errorCode, summary: job.errorSummary } : null,
              published_version: job.publishedVersion
                ? { id: job.publishedVersion.id, workspace_id: job.publishedVersion.workspaceId }
                : null,
            }),
          }],
        };
      } catch (error) {
        return inputFailure(error, logger, 'get_index_job');
      }
    },
  );
};

const registerQueryTools = (
  server: McpServer,
  querySnapshot: ReturnType<typeof createQuerySnapshot>,
): void => {
  server.registerTool(
    'query_graph',
    {
      description: 'Synchronously perform local hybrid retrieval against the latest published snapshot in a workspace. Defaults to workspace "default".',
      inputSchema: {
        workspace_id: workspaceIdSchema,
        query: z.string().trim().min(1).max(4000),
        max_results: z.number().int().min(1).max(20).default(5),
        community_level: communityLevelSchema,
      },
    },
    async ({ workspace_id, query, max_results, community_level }) =>
      querySnapshot(workspace_id, query, 'local', max_results, community_level),
  );

  server.registerTool(
    'query_graph_global',
    {
      description: 'Run corpus-wide Map-Reduce retrieval over leaf communities by default, or one exact level when community_level is an integer. Use "leaf" to select all terminal communities. Defaults to workspace "default".',
      inputSchema: {
        workspace_id: workspaceIdSchema,
        query: z.string().trim().min(1).max(4000),
        community_level: globalCommunityLevelSchema,
      },
    },
    async ({ workspace_id, query, community_level }) =>
      querySnapshot(workspace_id, query, 'global', 5, community_level),
  );
};

export const createMcpServer = (
  store: IndexStore,
  config: AppConfig,
  logger: Logger,
  queryLimiter = createQueryLimiter(config.MAX_ACTIVE_QUERIES),
): McpServer => {
  const server = new McpServer({ name: 'graphrag-mcp-server', version: '0.1.0' });
  const context = { store, config, logger };
  registerPathInputTool(server, context);
  registerTextInputTool(server, context);
  registerJobTool(server, context);
  registerQueryTools(server, createQuerySnapshot(context, queryLimiter));
  return server;
};