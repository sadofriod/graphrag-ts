import type { Prisma } from '@prisma/client';
import { withNamespace } from '../../namespace/namespaceContext';
import { prismaClient } from './prismaClient';

export const withGraphWrite = <Result>(
  namespace: string,
  operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
): Promise<Result> => withNamespace(namespace, () => prismaClient.$transaction(async (transaction) => {
  await transaction.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${namespace}, 0))`;
  return operation(transaction);
}));

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