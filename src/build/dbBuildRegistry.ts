import { logger } from '../logger';
import { prismaClient } from './helper/prismaClient';

import type { BuildJob, BuildRegistry } from './buildRegistry';

const toBuildJob = (row: {
  id: string;
  state: string;
  title: string | null;
  namespace: string;
  createdAt: Date;
  finishedAt: Date | null;
  error: string | null;
}): BuildJob => ({
  id: row.id,
  status: row.state as BuildJob['status'],
  title: row.title ?? '',
  namespace: row.namespace,
  createdAt: row.createdAt.getTime(),
  ...(row.finishedAt !== null ? { finishedAt: row.finishedAt.getTime() } : {}),
  ...(row.error !== null ? { error: row.error } : {}),
});

const persist = (
  pending: Map<string, Promise<void>>,
  id: string,
  logTag: string,
  op: () => Promise<unknown>,
): void => {
  const prev = (pending.get(id) ?? Promise.resolve()).catch(() => undefined);
  const next = prev.then(op).then(
    () => undefined,
    (error: unknown) => logger.error({ id, err: error }, logTag),
  );
  pending.set(id, next);
};

export const createDbBuildRegistry = (): BuildRegistry => {
  const mirror = new Map<string, BuildJob>();
  const pending = new Map<string, Promise<void>>();

  return {
    create({ title, namespace }) {
      const id = crypto.randomUUID();
      const now = Date.now();
      mirror.set(id, { id, status: 'pending', title, namespace, createdAt: now });
      persist(pending, id, 'db build registry create failed', () =>
        prismaClient.generationJob.create({
          data: {
            id,
            namespace,
            kind: 'ragBuild',
            title,
            state: 'pending',
            phase: 'processing',
            createdAt: new Date(now),
          },
        }),
      );
      return id;
    },
    update(id, patch) {
      const job = mirror.get(id);
      if (!job) {
        return;
      }
      Object.assign(job, patch);
      persist(pending, id, 'db build registry update failed', () =>
        prismaClient.generationJob.update({
          where: { id },
          data: {
            ...(patch.status !== undefined ? { state: patch.status } : {}),
            ...(patch.error !== undefined ? { error: patch.error } : {}),
            ...(patch.finishedAt !== undefined ? { finishedAt: new Date(patch.finishedAt) } : {}),
          },
        }),
      );
    },
    get(id) {
      return mirror.get(id);
    },
  };
};

export const readBuildJobFromDb = async (
  id: string,
  namespace: string,
): Promise<BuildJob | undefined> => {
  const row = await prismaClient.generationJob.findUnique({ where: { id, namespace } });
  return row && row.kind === 'ragBuild' ? toBuildJob(row) : undefined;
};
