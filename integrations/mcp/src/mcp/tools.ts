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
import { ToolError, inputFailure, paymentRequiredResult, toolErrorResult } from './errors.ts';
import { runSnapshotQuery, QueryServiceError } from '../queryService.ts';
import type { Judge, PaperRef } from '../integrity/judge.ts';
import type { IntegrityStore } from '../integrity/store.ts';

type ToolContext = {
  readonly store: IndexStore;
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly authorize?: AccessGuard;
};

type IntegrityToolName = 'integrity_paper_status' | 'retraction_propagation' | 'integrity_evidence_audit';

export const integrityToolPrices = {
  'retraction-propagation': { product: 'retraction-propagation', usd: '$0.02', atomic: '20000' },
  'retraction-evidence-audit': { product: 'retraction-evidence-audit', usd: '$0.10', atomic: '100000' },
} as const;

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
      title: 'Submit indexing job',
      description: 'Queue Markdown files from the configured read-only input directory for indexing into a workspace snapshot. Use this when a corpus directory or subdirectory should be indexed; do not use it to submit inline text, which belongs in remember_text. workspace_id selects the destination and defaults to "default"; path is a relative path inside the configured input directory; source optionally prefixes document source labels. The result carries job_id, workspace_id, queued status, and queue_position. Errors are returned as structured tool errors. Requires indexing access; this operation creates a job and is not idempotent.',
      inputSchema: {
        workspace_id: workspaceIdSchema.describe('Destination workspace slug, up to 63 lowercase letters, digits, or hyphens; defaults to "default".'),
        path: z.string().min(1).max(1024).describe('Non-empty relative path, up to 1024 characters, inside the configured read-only input directory; absolute paths, parent traversal, and symlinks are rejected.'),
        source: z.string().max(200).optional().describe('Optional source-label prefix, up to 200 characters, applied to each indexed Markdown file.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
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
      title: 'Remember text',
      description: 'Queue explicitly supplied text as a Markdown source for indexing in a workspace; this tool never reads chat history or other conversation content. Use it for text provided in this call, and use submit_index_job for files in the configured input directory. workspace_id selects the destination and defaults to "default"; source is an optional stable label of at most 200 characters, otherwise a hash-based label is assigned. The result carries job_id, workspace_id, queued status, and queue_position. Errors are structured tool errors. Requires indexing access; submitting creates a job and is not idempotent.',
      inputSchema: {
        workspace_id: workspaceIdSchema.describe('Destination workspace slug, up to 63 lowercase letters, digits, or hyphens; defaults to "default".'),
        text: z.string().min(1).describe('Non-empty text to queue as Markdown; only text explicitly supplied here is used.'),
        source: z.string().max(200).optional().describe('Optional stable source label, up to 200 characters; omitted labels are generated from the text hash.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
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
      title: 'Get indexing job',
      description: 'Read an indexing job and its safe status summary within the selected workspace. Use this to poll a job_id returned by submit_index_job or remember_text; it does not fetch document contents, and an unknown or cross-workspace job is not returned. workspace_id defaults to "default" and job_id must be a UUID. The result carries status, phase, lifecycle timestamps, a safe error code/summary if one occurred, and the published version reference when available. Failures use structured tool errors such as JOB_NOT_FOUND. Requires read access and does not modify job state.',
      inputSchema: {
        workspace_id: workspaceIdSchema.describe('Workspace containing the job, up to 63 lowercase letters, digits, or hyphens; defaults to "default".'),
        job_id: z.string().uuid().describe('UUID returned by submit_index_job or remember_text.'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
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
      title: 'Query workspace graph',
      description: 'Run local hybrid retrieval against the latest successfully published GraphRAG snapshot in one workspace and return a grounded answer with source evidence. Use it for focused questions answered from locally retrieved graph passages; do not use it when the question requires corpus-wide synthesis, for which query_graph_global is intended. workspace_id defaults to "default"; query is 1–4000 characters; max_results is 1–20 and defaults to 5; community_level optionally restricts retrieval to a non-negative hierarchy level. The result is text containing the answer and evidence; errors are structured tool results such as INDEX_NOT_READY or QUERY_TIMEOUT. Requires query access; read-only.',
      inputSchema: {
        workspace_id: workspaceIdSchema.describe('Workspace whose latest published snapshot is queried; up to 63 lowercase letters, digits, or hyphens; defaults to "default".'),
        query: z.string().trim().min(1).max(4000).describe('Question or search request, trimmed and limited to 1–4000 characters.'),
        max_results: z.number().int().min(1).max(20).default(5).describe('Maximum number of local results, an integer from 1 to 20; defaults to 5.'),
        community_level: communityLevelSchema.describe('Optional non-negative integer hierarchy level used to filter retrieval; omitted to use the normal local search scope.'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ workspace_id, query, max_results, community_level }) =>
      querySnapshot(workspace_id, query, 'local', max_results, community_level),
  );

  server.registerTool(
    'query_graph_global',
    {
      title: 'Query graph globally',
      description: 'Run corpus-wide Map-Reduce retrieval over community summaries in the latest published snapshot and return a synthesized answer. Use it for questions needing themes across the workspace; use query_graph for focused passage retrieval. workspace_id defaults to "default"; query is 1–4000 characters; community_level may be omitted for terminal communities, set to a non-negative integer for one exact level, or set to "leaf" for terminal communities across uneven branches. The result is text containing the synthesized answer and evidence; failures are structured tool results such as INDEX_NOT_READY or QUERY_TIMEOUT. Requires global-query access; read-only.',
      inputSchema: {
        workspace_id: workspaceIdSchema.describe('Workspace whose latest published snapshot is queried; up to 63 lowercase letters, digits, or hyphens; defaults to "default".'),
        query: z.string().trim().min(1).max(4000).describe('Question for corpus-wide synthesis, trimmed and limited to 1–4000 characters.'),
        community_level: globalCommunityLevelSchema.describe('Optional non-negative integer hierarchy level, or "leaf" for all terminal communities; omitted to use the default terminal-community scope.'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
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

const integrityPaperRefWireSchema = z.object({
  doi: z.string().min(1).optional().describe('DOI of the paper, e.g. 10.1016/S0140-6736(97)11096-0. Provide exactly one of doi or paper_id.'),
  paper_id: z.string().min(1).optional().describe('Internal paper id from a previous integrity_paper_status response. Provide exactly one of doi or paper_id.'),
});

export type McpIntegrityOptions = { readonly store: IntegrityStore; readonly judge: Judge };
export type McpToolOptions = {
  readonly integrity?: McpIntegrityOptions;
  readonly tier?: 'public' | 'keyed';
  readonly paywallPayEndpoint?: string;
  readonly paywallDocsUrl?: string;
};

const isPaperNotFound = (payload: unknown): boolean => typeof payload === 'object' && payload !== null
  && 'abstention_reason' in payload && payload.abstention_reason === 'paper_not_in_snapshot';

type IntegrityToolDefinition = {
  readonly name: IntegrityToolName;
  readonly title: string;
  readonly description: string;
  readonly run: (reference: PaperRef) => Promise<unknown>;
  readonly status: boolean;
  readonly payment?: (typeof integrityToolPrices)[keyof typeof integrityToolPrices] | undefined;
};

const createIntegrityToolHandler = (definition: IntegrityToolDefinition, judge: Judge, logger: Logger, publicTier: boolean, payEndpoint: string, docsUrl: string) => async (reference: unknown) => {
  const parsedReference = integrityPaperRefSchema.safeParse(reference);
  if (!parsedReference.success) {
    return toolErrorResult('INVALID_REFERENCE', 'Provide exactly one of doi or paper_id.');
  }
  if (publicTier && definition.payment) {
    return paymentRequiredResult({ ...definition.payment, payEndpoint, docsUrl });
  }
  try {
    const payload = await definition.run({ ...(parsedReference.data.doi === undefined ? {} : { doi: parsedReference.data.doi }), ...(parsedReference.data.paper_id === undefined ? {} : { paper_id: parsedReference.data.paper_id }) });
    if (definition.status && isPaperNotFound(payload)) {
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
};

const registerIntegrityTools = (server: McpServer, judge: Judge, logger: Logger, publicTier: boolean, payEndpoint: string, docsUrl: string): void => {
  const definitions: readonly IntegrityToolDefinition[] = [
    {
      name: 'integrity_paper_status', title: 'Get paper integrity status',
      description: 'Read the paper identity and retraction assertions recorded in the active integrity snapshot. Use this to check source status before requesting a judgment; it reports the stored assertions without inferring whether retraction evidence propagates to citing papers. Provide exactly one of doi or paper_id; a paper_id can come from an earlier status result. The result carries paper identity and source statuses, or a structured error such as PAPER_NOT_FOUND or NO_SNAPSHOT. This status lookup is available on public and keyed sessions, requires no paid judgment call, and does not modify data.',
      run: judge.paperStatus, status: true,
    },
    {
      name: 'retraction_propagation',
      title: 'Judge retraction propagation',
      description: `Assess whether evidence of retraction propagates to a target paper using the active integrity snapshot. Use it when a propagation verdict and retracted-root evidence are needed; use integrity_paper_status for source assertions only, or integrity_evidence_audit for a detailed evidence path. Provide exactly one of doi or paper_id; paper_id may come from integrity_paper_status. The result carries verdict, confidence, roots, conflicts, coverage, and any abstention reason; structured errors include NO_SNAPSHOT or JUDGE_FAILED. Paid: ${integrityToolPrices['retraction-propagation'].usd} per call via x402 on Base, POST /api/v1/judge; public calls require payment and a keyed MCP session unlocks the result. Read-only judgment.`,
      run: judge.retractionPropagation, status: false,
      payment: integrityToolPrices['retraction-propagation'],
    },
    {
      name: 'integrity_evidence_audit',
      title: 'Audit integrity evidence',
      description: `Inspect the evidence path, source tiers, and conflicts for a retraction-propagation assessment in the active integrity snapshot. Use it when provenance details are needed; use integrity_paper_status for source assertions or retraction_propagation for the compact judgment. Provide exactly one of doi or paper_id; paper_id may come from integrity_paper_status. The result carries verdict, confidence, evidence_path, tier_distribution, conflicts, coverage, explanation, and abstention reason; structured errors include NO_SNAPSHOT or JUDGE_FAILED. Paid: ${integrityToolPrices['retraction-evidence-audit'].usd} per call via x402 on Base, POST /api/v1/judge; public calls require payment and a keyed MCP session unlocks the result. Read-only audit.`,
      run: judge.evidenceAudit, status: false,
      payment: integrityToolPrices['retraction-evidence-audit'],
    },
  ] as const;

  for (const definition of definitions) {
    server.registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: integrityPaperRefWireSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      createIntegrityToolHandler(definition, judge, logger, publicTier, payEndpoint, docsUrl),
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
  if (options.tier !== 'public') {
    registerPathInputTool(server, context);
    registerTextInputTool(server, context);
    registerJobTool(server, context);
    registerQueryTools(server, createQuerySnapshot(context, queryLimiter));
  }
  if (options.integrity) registerIntegrityTools(
    server, options.integrity.judge, logger, options.tier === 'public',
    options.paywallPayEndpoint ?? config.MCP_PAYWALL_PAY_ENDPOINT,
    options.paywallDocsUrl ?? config.MCP_PAYWALL_DOCS_URL,
  );
  return server;
};
