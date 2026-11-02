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

export const communityLevelSchema = z.number().int().min(0).optional()
  .describe('Restrict retrieval to one community level of the graph hierarchy: 0 is the coarsest, higher integers are finer. Omit to search across levels.');

export const globalCommunityLevelSchema = z.union([
  z.number().int().min(0),
  z.literal('leaf'),
]).optional()
  .describe('Which communities to summarise: "leaf" (default) for all terminal communities, or an integer to use exactly that level of the hierarchy (higher levels are broader and cheaper).');

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
      description: 'Queue Markdown files from the configured read-only input directory for indexing into a workspace\'s knowledge graph. Returns immediately with a job id; the build runs in the background, so poll get_index_job and only call query_graph after a new snapshot is published. Files are snapshotted when the job is accepted; later edits on disk are not picked up by this job. Shared-filesystem ingestion is disabled on hosted endpoints — use remember_text there. Returns: job_id, workspace_id, status ("queued"), queue_position.',
      inputSchema: {
        workspace_id: workspaceIdSchema,
        path: z.string().min(1).max(1024).describe('File or directory path relative to the configured input root. Every Markdown file under it is queued.'),
        source: z.string().max(200).optional().describe('Optional label prefix stored with the documents; it appears in citations and groups files that belong together.'),
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
      description: 'Queue caller-supplied text as a document in a workspace\'s knowledge graph. Use this when the text is not already on the server\'s filesystem: it indexes exactly the text you pass and never reads chat history, files or URLs. The text becomes citable source material for later query_graph answers. Indexing is asynchronous — follow up with get_index_job, and the text is not searchable until the job publishes a new snapshot. Returns: job_id, workspace_id, status ("queued"), queue_position.',
      inputSchema: {
        workspace_id: workspaceIdSchema,
        text: z.string().min(1).describe('The document body. Markdown is supported; one call is one document, so split very large inputs yourself.'),
        source: z.string().max(200).optional().describe('Optional label stored with the document and shown in citations.'),
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
      description: 'Get the current state of an indexing job: lifecycle status, build phase, timestamps, the published snapshot version when one exists, and a safe error summary when it failed. Use it to poll after submit_index_job or remember_text, and to confirm that a new snapshot is live before querying. Status values: queued, in_progress, published, failed. Returns: job_id, workspace_id, status, phase, created_at, started_at, finished_at, error {code, summary} or null, published_version {id, workspace_id} or null. Errors: JOB_NOT_FOUND when no job with that id exists in the workspace.',
      inputSchema: {
        workspace_id: workspaceIdSchema,
        job_id: z.string().uuid().describe('The job id (UUID) returned by submit_index_job or remember_text.'),
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
      description: 'Answer a question over one workspace\'s knowledge graph with local hybrid retrieval: vector similarity, keyword match and graph neighbourhoods are combined, the strongest passages and their entities are selected, and the answer is composed from them with source evidence. Use it for questions a handful of documents can answer; use query_graph_global for corpus-wide synthesis. It reads the latest published snapshot only, so results are stable until a new build publishes. Returns: an answer plus the evidence snippets behind it, each with the source document and chunk it came from.',
      inputSchema: {
        workspace_id: workspaceIdSchema,
        query: z.string().trim().min(1).max(4000).describe('The natural-language question or claim to check against the corpus (max 4000 characters).'),
        max_results: z.number().int().min(1).max(20).default(5).describe('How many evidence passages to retrieve and consider, 1–20 (default 5). Raise it for broad questions, lower it when you want a tight, cheap answer.'),
        community_level: communityLevelSchema,
      },
    },
    async ({ workspace_id, query, max_results, community_level }) =>
      querySnapshot(workspace_id, query, 'local', max_results, community_level),
  );

  server.registerTool(
    'query_graph_global',
    {
      description: 'Answer a corpus-wide question by Map-Reduce over community summaries: every selected community is summarised against the query, then the partial answers are reduced into one response that lists the communities it drew on. Use it for themes, trends and overviews across a whole corpus; for pinpoint lookups or single-document questions use query_graph instead. Returns: the reduced answer with the community summaries and the source evidence behind them. Raises QUERY_CAPACITY when the server is at its active-query limit — retry shortly.',
      inputSchema: {
        workspace_id: workspaceIdSchema,
        query: z.string().trim().min(1).max(4000).describe('The natural-language question about the corpus as a whole (max 4000 characters).'),
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
export type McpToolOptions = {
  readonly integrity?: McpIntegrityOptions;
  readonly tier?: 'public' | 'keyed';
  readonly onPublicCall?: (record: { tool: string; outcome: 'ok' | 'error'; latencyMs: number }) => void;
  readonly paywallPayEndpoint?: string;
  readonly paywallDocsUrl?: string;
};

const isPaperNotFound = (payload: unknown): boolean => typeof payload === 'object' && payload !== null
  && 'abstention_reason' in payload && payload.abstention_reason === 'paper_not_in_snapshot';

const registerIntegrityTools = (
  server: McpServer,
  judge: Judge,
  logger: Logger,
  publicTier: boolean,
  onPublicCall: McpToolOptions['onPublicCall'],
  payEndpoint: string,
  docsUrl: string,
): void => {
  const definitions: readonly {
    readonly name: IntegrityToolName;
    readonly description: string;
    readonly run: (reference: PaperRef) => Promise<unknown>;
    readonly status: boolean;
    readonly payment?: (typeof integrityToolPrices)[keyof typeof integrityToolPrices] | undefined;
  }[] = [
    { name: 'integrity_paper_status', description: 'Look up one paper by DOI or OpenAlex id and return its identity (title, year, venue) plus every retraction record the graph holds for it, each with its source and source tier: A is an official registry, B an authoritative index, C an aggregator. Use it to check whether a paper is retracted and which sources assert it; use retraction_propagation to judge whether that retraction reaches a specific citing paper. Free in the public tier. Returns: paper identity and statuses[] with source, source_tier, is_retracted, retraction_date and source_uri; abstention_reason when the paper is not in the snapshot.', run: judge.paperStatus, status: true },
    {
      name: 'retraction_propagation',
      description: `Judge whether a retraction propagates to a paper through its citation graph: retraction evidence is weighted by source tier, the citing context is checked for an acknowledgement, and the tool returns CONTESTED, SUPPORTED or ABSTAINED with the evidence path behind the verdict. Use it after integrity_paper_status when the question is "does this retraction reach this paper". It abstains instead of guessing when reference coverage is thin. Returns: verdict, confidence, the evidence path that produced it, and abstention details when the verdict is ABSTAINED. Paid: ${integrityToolPrices['retraction-propagation'].usd} per call (x402 on Base, POST /api/v1/judge); a keyed MCP session also unlocks it.`,
      run: judge.retractionPropagation, status: false,
      payment: integrityToolPrices['retraction-propagation'],
    },
    {
      name: 'integrity_evidence_audit',
      description: `Audit the evidence behind a paper's retraction picture: every source record with its tier and URI, the dates involved, conflicts between sources (an official registry and an aggregator disagreeing, or a citation acknowledging a retraction the graph does not propagate) and the coverage gaps that bound the conclusion. Use it when you must justify or challenge a verdict; for a one-line status use integrity_paper_status. Returns: evidence records with source tiers and URIs, detected conflict flags with codes and details, and the coverage that limits how strong the conclusion can be. Paid: ${integrityToolPrices['retraction-evidence-audit'].usd} per call (x402 on Base, POST /api/v1/judge); a keyed MCP session also unlocks it.`,
      run: judge.evidenceAudit, status: false,
      payment: integrityToolPrices['retraction-evidence-audit'],
    },
  ] as const;

  const timed = <T>(name: string, run: () => Promise<T>): Promise<T> => {
    if (!publicTier || !onPublicCall) return run();
    const startedAt = Date.now();
    const report = (outcome: 'ok' | 'error'): void => {
      const latencyMs = Date.now() - startedAt;
      setTimeout(() => {
        try {
          onPublicCall({ tool: name, outcome, latencyMs });
        } catch {
          // Metrics must not affect the tool response.
        }
      });
    };
    return run().then(
      (result) => {
        report('ok');
        return result;
      },
      (error: unknown) => {
        report('error');
        throw error;
      },
    );
  };

  for (const definition of definitions) {
    server.registerTool(
      definition.name,
      { description: definition.description, inputSchema: integrityPaperRefSchema },
      (reference) => timed(definition.name, async () => {
        if (publicTier && definition.payment) {
          return paymentRequiredResult({ ...definition.payment, payEndpoint, docsUrl });
        }
        try {
          const payload = await definition.run({
            ...(reference.doi === undefined ? {} : { doi: reference.doi }),
            ...(reference.paper_id === undefined ? {} : { paper_id: reference.paper_id }),
          });
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
      }),
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
    options.onPublicCall,
    options.paywallPayEndpoint ?? config.MCP_PAYWALL_PAY_ENDPOINT,
    options.paywallDocsUrl ?? config.MCP_PAYWALL_DOCS_URL,
  );
  return server;
};
