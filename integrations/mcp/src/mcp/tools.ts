import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AppConfig } from '../config.ts';
import { retrieve, retrieveGlobal } from '../graph-rag.ts';
import { InputError, pathInputs, textInput } from '../input.ts';
import { formatGlobalQueryOutput, formatQueryOutput } from '../output.ts';
import type { Logger } from '../log.ts';
import type { IndexStore } from '../store.ts';

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

const createQuerySnapshot = ({ store, config, logger }: ToolContext) => async (
    query: string,
    mode: 'local' | 'global',
    maxResults: number,
    communityLevel?: number,
  ) => {
    const version = await store.getActiveVersion();
    if (!version) {
      return toolErrorResult('INDEX_NOT_READY', 'No index is published yet. Submit an indexing job and check its status.');
    }

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new ToolError('QUERY_TIMEOUT', 'The GraphRAG query exceeded its configured time limit.')),
          config.QUERY_TIMEOUT_MS,
        );
      });
      if (mode === 'global') {
        const result = await Promise.race([retrieveGlobal(query, version.namespace, communityLevel), timeout]);
        return {
          content: [{
            type: 'text' as const,
            text: formatGlobalQueryOutput(result, version, config.MAX_OUTPUT_CHARS),
          }],
        };
      }

      const result = await Promise.race([
        retrieve(query, version.namespace, maxResults, communityLevel),
        timeout,
      ]);
      return {
        content: [{
          type: 'text' as const,
          text: formatQueryOutput(result, version, config.MAX_OUTPUT_CHARS),
        }],
      };
    } catch (error) {
      if (error instanceof ToolError) {
        return toolErrorResult(error.code, error.message);
      }
      logger.error('MCP tool failed.', {
        tool: mode === 'global' ? 'query_graph_global' : 'query_graph',
        error_name: error instanceof Error ? error.name : 'UnknownError',
      });
      return toolErrorResult(
        'UPSTREAM_ERROR',
        'GraphRAG retrieval failed. Check the configured model service and server logs.',
      );
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  };

const registerPathInputTool = (server: McpServer, { store, config, logger }: ToolContext): void => {
  server.registerTool(
    'submit_index_job',
    {
      description: 'Queue Markdown files from the configured read-only input directory for indexing.',
      inputSchema: {
        path: z.string().min(1).max(1024),
        source: z.string().max(200).optional(),
      },
    },
    async ({ path, source }) => {
      try {
        const inputs = await pathInputs(path, config);
        const job = await store.enqueue(
          source
            ? inputs.map((input) => ({ ...input, sourceLabel: `${source}/${input.sourceLabel}` }))
            : inputs,
        );
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ job_id: job.id, status: 'queued', queue_position: job.queuePosition }),
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
      description: 'Explicitly queue user-provided text for indexing; this tool does not read chat history.',
      inputSchema: {
        text: z.string().min(1),
        source: z.string().max(200).optional(),
      },
    },
    async ({ text, source }) => {
      try {
        const job = await store.enqueue(textInput(text, source, config));
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ job_id: job.id, status: 'queued', queue_position: job.queuePosition }),
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
      description: 'Get the status and safe error summary for an indexing job.',
      inputSchema: { job_id: z.string().uuid() },
    },
    async ({ job_id }) => {
      try {
        const job = await store.getJob(job_id);
        if (!job) {
          return toolErrorResult('JOB_NOT_FOUND', 'No indexing job exists with that ID.');
        }
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              job_id: job.id,
              status: job.status,
              phase: job.phase,
              created_at: job.createdAt.toISOString(),
              started_at: job.startedAt?.toISOString() ?? null,
              finished_at: job.finishedAt?.toISOString() ?? null,
              error: job.errorCode ? { code: job.errorCode, summary: job.errorSummary } : null,
              published_version: job.publishedVersion,
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
      description: 'Synchronously perform local hybrid retrieval against the latest published GraphRAG snapshot.',
      inputSchema: {
        query: z.string().trim().min(1).max(4000),
        max_results: z.number().int().min(1).max(20).default(5),
        community_level: z.number().int().min(0).optional(),
      },
    },
    async ({ query, max_results, community_level }) =>
      querySnapshot(query, 'local', max_results, community_level),
  );

  server.registerTool(
    'query_graph_global',
    {
      description: 'Run corpus-wide Map-Reduce retrieval over one community hierarchy level.',
      inputSchema: {
        query: z.string().trim().min(1).max(4000),
        community_level: z.number().int().min(0).optional(),
      },
    },
    async ({ query, community_level }) => querySnapshot(query, 'global', 5, community_level),
  );
};

export const createMcpServer = (store: IndexStore, config: AppConfig, logger: Logger): McpServer => {
  const server = new McpServer({ name: 'graphrag-mcp-server', version: '0.1.0' });
  const context = { store, config, logger };
  registerPathInputTool(server, context);
  registerTextInputTool(server, context);
  registerJobTool(server, context);
  registerQueryTools(server, createQuerySnapshot(context));
  return server;
};