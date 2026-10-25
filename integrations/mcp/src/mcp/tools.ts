import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AppConfig } from '../config.ts';
import { normalizeSourceLabel, pathInputs, textInput } from '../input.ts';
import { formatGlobalQueryOutput, formatQueryOutput } from '../output.ts';
import type { Logger } from '../log.ts';
import type { IndexStore } from '../store.ts';
import { workspaceIdSchema } from '../workspace.ts';
import { withQuerySlot, type QuerySlot } from '../x402/slot.ts';
import { AccessError, type AccessGuard } from '../access.ts';
import { ToolError, inputFailure, toolErrorResult } from './errors.ts';
import { runSnapshotQuery, QueryServiceError } from '../queryService.ts';
import type { Judge, PaperRef } from '../integrity/judge.ts';
import type { IntegrityStore } from '../integrity/store.ts';

type ToolContext = {
  readonly store: IndexStore;
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly authorize?: AccessGuard;
};

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

const queryErrorResponses = {
  INDEX_NOT_READY: ['INDEX_NOT_READY', 'No index is published yet. Submit an indexing job and check its status.'],
  QUERY_TIMEOUT: ['QUERY_TIMEOUT', 'The GraphRAG query exceeded its configured time limit.'],
} as const;

const queryFailureResponse = (error: QueryServiceError) => {
  const known = queryErrorResponses[error.code as keyof typeof queryErrorResponses];
  if (known) return toolErrorResult(known[0], known[1]);
  return toolErrorResult('UPSTREAM_ERROR', 'GraphRAG retrieval failed. Check the configured model service and server logs.');
};

const handleQueryError = (error: unknown, logger: Logger, mode: 'local' | 'global') => {
  if (error instanceof QueryServiceError) {
    if (error.code === 'QUERY_FAILED') {
      logger.error('MCP tool failed.', { tool: mode === 'global' ? 'query_graph_global' : 'query_graph', error_name: error.cause instanceof Error ? error.cause.name : 'UnknownError' });
      return toolErrorResult('UPSTREAM_ERROR', 'GraphRAG retrieval failed. Check the configured model service and server logs.');
    }
    return queryFailureResponse(error);
  }
  if (error instanceof ToolError) return toolErrorResult(error.code, error.message);
  logger.error('MCP tool failed.', { tool: mode === 'global' ? 'query_graph_global' : 'query_graph', error_name: error instanceof Error ? error.name : 'UnknownError' });
  return toolErrorResult('UPSTREAM_ERROR', 'GraphRAG retrieval failed. Check the configured model service and server logs.');
};

const executeQuery = async (
  { store, config, logger }: ToolContext,
  workspaceId: string,
  query: string,
  mode: 'local' | 'global',
  maxResults: number,
  communityLevel: number | 'leaf' | undefined,
  slot: QuerySlot,
) => {
  const operationId = randomUUID();
  try {
    const snapshot = await runSnapshotQuery({ store, config, logger }, {
      workspaceId, query, mode, maxResults, ...(communityLevel === undefined ? {} : { communityLevel }), operationId,
    });
    if ('communityLevel' in snapshot.result) {
      return { content: [{ type: 'text' as const, text: formatGlobalQueryOutput(snapshot.result, snapshot.version, config.MAX_OUTPUT_CHARS) }] };
    }
    if ('communities' in snapshot.result) {
      return { content: [{ type: 'text' as const, text: formatQueryOutput(snapshot.result, snapshot.version, config.MAX_OUTPUT_CHARS) }] };
    }
    return toolErrorResult('INTERNAL_ERROR', 'GraphRAG returned an unexpected result shape.');
  } catch (error) {
    if (error instanceof QueryServiceError && error.completion) slot.releaseAfter(error.completion);
    return handleQueryError(error, logger, mode);
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
    try {
      await context.authorize?.(workspaceId, mode === 'global' ? 'global_query' : 'query');
    } catch (error) {
      return inputFailure(error, context.logger, 'query_graph');
    }
    return withQuerySlot(
      queryLimiter,
      () => toolErrorResult('QUERY_CAPACITY', 'The server has reached its active query limit. Try again shortly.'),
      async (slot) => executeQuery(context, workspaceId, query, mode, maxResults, communityLevel, slot),
    );
  };
};

const registerPathInputTool = (server: McpServer, { store, config, logger, authorize }: ToolContext): void => {
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
        if (authorize) {
          throw new AccessError('FORBIDDEN', 'Shared filesystem ingestion is disabled in hosted mode. Use remember_text.');
        }
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

const registerTextInputTool = (server: McpServer, { store, config, logger, authorize }: ToolContext): void => {
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
        const inputs = textInput(text, source, config);
        await authorize?.(workspace_id, 'index');
        const job = await store.enqueue(inputs, workspace_id);
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

const registerJobTool = (server: McpServer, { store, logger, authorize }: ToolContext): void => {
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
        await authorize?.(workspace_id, 'read');
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

export const integrityPaperRefSchema = z.object({
  doi: z.string().min(1).optional(),
  paper_id: z.string().min(1).optional(),
}).refine((reference) => Number(reference.doi !== undefined) + Number(reference.paper_id !== undefined) === 1, {
  message: 'Provide exactly one of doi or paper_id.',
});

export type McpIntegrityOptions = { readonly store: IntegrityStore; readonly judge: Judge };
export type McpToolOptions = { readonly integrity?: McpIntegrityOptions };
type IntegrityToolName = 'integrity_paper_status' | 'retraction_propagation' | 'integrity_evidence_audit';

const registerIntegrityTools = (server: McpServer, judge: Judge, logger: Logger): void => {
  const definitions: readonly { readonly name: IntegrityToolName; readonly description: string; readonly run: (reference: PaperRef) => Promise<unknown>; readonly status: boolean }[] = [
    { name: 'integrity_paper_status', description: 'Get retraction status and identity for a paper.', run: judge.paperStatus, status: true },
    { name: 'retraction_propagation', description: 'Judge whether retraction evidence propagates to a paper.', run: judge.retractionPropagation, status: false },
    { name: 'integrity_evidence_audit', description: 'Audit the evidence path, source tiers, and conflicts for a paper.', run: judge.evidenceAudit, status: false },
  ] as const;

  for (const definition of definitions) {
    server.registerTool(
      definition.name,
      { description: definition.description, inputSchema: integrityPaperRefSchema },
      async (reference) => {
        try {
          const payload = await definition.run({
            ...(reference.doi === undefined ? {} : { doi: reference.doi }),
            ...(reference.paper_id === undefined ? {} : { paper_id: reference.paper_id }),
          });
          if (definition.status && typeof payload === 'object' && payload !== null
            && 'abstention_reason' in payload && payload.abstention_reason === 'paper_not_in_snapshot') {
            logger.error('MCP tool failed.', { tool: definition.name, error_name: 'PaperNotFoundError' });
            return toolErrorResult('PAPER_NOT_FOUND', 'The paper is not present in the active integrity snapshot.');
          }
          return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] };
        } catch (error) {
          const errorName = error instanceof Error ? error.name : 'UnknownError';
          logger.error('MCP tool failed.', { tool: definition.name, error_name: errorName });
          if (error instanceof Error && error.message.includes('No active integrity snapshot')) {
            return toolErrorResult('NO_SNAPSHOT', 'No active integrity snapshot is available.');
          }
          return toolErrorResult('JUDGE_FAILED', 'The integrity judgment failed. Check the server logs for details.');
        }
      },
    );
  }
};

export const createMcpServer = (
  store: IndexStore,
  config: AppConfig,
  logger: Logger,
  queryLimiter = createQueryLimiter(config.MAX_ACTIVE_QUERIES),
  authorize?: AccessGuard,
  options: McpToolOptions = {},
): McpServer => {
  const server = new McpServer({ name: 'graphrag-mcp-server', version: '0.1.0' });
  const context = { store, config, logger, ...(authorize ? { authorize } : {}) };
  registerPathInputTool(server, context);
  registerTextInputTool(server, context);
  registerJobTool(server, context);
  registerQueryTools(server, createQuerySnapshot(context, queryLimiter));
  if (options.integrity) registerIntegrityTools(server, options.integrity.judge, logger);
  return server;
};
