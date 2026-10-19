import type { Logger } from '../log.ts';
import type { IndexStore } from '../store.ts';
import { ToolError, toolErrorResult } from './errors.ts';

export const createQueryActivity = (
  store: IndexStore,
  logger: Logger,
  workspaceId: string,
  operationId: string,
) => async (
  level: 'info' | 'warn' | 'error',
  message: string,
  details: Record<string, unknown> = {},
): Promise<void> => {
  await store.appendActivityLog({ workspaceId, operationId, kind: 'retrieval', level, message, details })
    .catch((error: unknown) => {
      logger.warn('Could not persist retrieval activity.', {
        error_name: error instanceof Error ? error.name : 'UnknownError',
      });
    });
};

export const queryFailure = async (
  error: unknown,
  logger: Logger,
  logActivity: ReturnType<typeof createQueryActivity>,
  mode: 'local' | 'global',
  startedAt: number,
) => {
  const code = error instanceof ToolError ? error.code : 'UPSTREAM_ERROR';
  await logActivity('error', 'Retrieval failed.', { mode, code, duration_ms: Date.now() - startedAt });
  if (error instanceof ToolError) return toolErrorResult(error.code, error.message);
  logger.error('MCP tool failed.', {
    tool: mode === 'global' ? 'query_graph_global' : 'query_graph',
    error_name: error instanceof Error ? error.name : 'UnknownError',
  });
  return toolErrorResult('UPSTREAM_ERROR', 'GraphRAG retrieval failed. Check the configured model service and server logs.');
};
