import { z } from 'zod';

export const DEFAULT_WORKSPACE_ID = 'default';

export const workspaceIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(63)
  .regex(/^[a-z0-9][a-z0-9-]*$/)
  .default(DEFAULT_WORKSPACE_ID)
  .describe('Workspace that owns the graph, 1–63 chars of [a-z0-9-]. Use the same id for every operation on one corpus. Defaults to "default".');

export type WorkspaceId = z.infer<typeof workspaceIdSchema>;
