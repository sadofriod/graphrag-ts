import type { Logger } from '../log.ts';
import type { IndexStore } from '../store.ts';

export const createActivityLogger = (
  store: IndexStore,
  logger: Logger,
  workspaceId: string,
  operationId: string,
) => async (
  level: 'info' | 'warn' | 'error',
  message: string,
  details: Record<string, unknown> = {},
): Promise<void> => {
  await store.appendActivityLog({
    workspaceId,
    operationId,
    kind: 'retrieval',
    level,
    message,
    details,
  }).catch((error: unknown) => {
    logger.warn('Could not persist retrieval activity.', {
      error_name: error instanceof Error ? error.name : 'UnknownError',
    });
  });
};
