import type { Prisma } from '@prisma/client';
import { withNamespace } from '../../namespace/namespaceContext';
import { prismaClient } from './prismaClient';

const GRAPH_WRITE_TRANSACTION_OPTIONS = {
  maxWait: 30_000,
  timeout: 120_000,
} as const;

const namespaceQueues = new Map<string, Promise<unknown>>();

const enqueueNamespaceWrite = <Result>(
  namespace: string,
  operation: () => Promise<Result>,
): Promise<Result> => {
  const previous = namespaceQueues.get(namespace) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  const cleanup = () => {
    if (namespaceQueues.get(namespace) === tracked) {
      namespaceQueues.delete(namespace);
    }
  };
  const tracked = next.then(cleanup, cleanup);
  namespaceQueues.set(namespace, tracked);
  return next;
};

export const withGraphWrite = <Result>(
  namespace: string,
  operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
): Promise<Result> =>
  enqueueNamespaceWrite(namespace, () =>
    withNamespace(namespace, () =>
      prismaClient.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${namespace}, 0))`;
        return operation(transaction);
      }, GRAPH_WRITE_TRANSACTION_OPTIONS),
    ),
  );

export const refreshEdgeContributions = async (
  transaction: Prisma.TransactionClient,
  edgeIds: readonly string[],
  namespace: string,
) => {
  const edges = [];
  for (const id of [...new Set(edgeIds)].sort()) {
    const contributions = await transaction.rAGEdgeContribution.findMany({
      where: { edgeId: id, namespace },
      orderBy: [{ relationshipDesc: 'asc' }, { parentId: 'asc' }],
    });
    const first = contributions[0];
    if (!first) {
      await transaction.rAGGraphEdge.deleteMany({ where: { id, namespace } });
      continue;
    }
    edges.push(await transaction.rAGGraphEdge.update({
      where: { id, namespace },
      data: {
        parentId: first.parentId,
        weight: contributions.reduce((total, contribution) => total + contribution.weight, 0),
        relationshipDesc: [...new Set(contributions.map(({ relationshipDesc }) => relationshipDesc))].join('; '),
      },
    }));
  }
  return edges;
};

export const removeParentEdgeContributions = async (
  transaction: Prisma.TransactionClient,
  parentIds: readonly string[],
  namespace: string,
): Promise<void> => {
  const where = { parentId: { in: [...parentIds] }, namespace };
  const contributions = await transaction.rAGEdgeContribution.findMany({ where, select: { edgeId: true } });
  await transaction.rAGEdgeContribution.deleteMany({ where });
  await refreshEdgeContributions(transaction, contributions.map(({ edgeId }) => edgeId), namespace);
};