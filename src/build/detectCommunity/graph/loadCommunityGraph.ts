import { prismaClient } from '../../helper/prismaClient';

export const loadCommunityGraph = async () => {
  const edges = await prismaClient.rAGGraphEdge.findMany({
    orderBy: [{ sourceEntityId: 'asc' }, { targetEntityId: 'asc' }],
    include: {
      sourceEntity: { select: { name: true } },
      targetEntity: { select: { name: true } },
    },
  });

  return {
    edges: edges.map(({ sourceEntity, targetEntity, weight }) => ({
      source: sourceEntity.name,
      target: targetEntity.name,
      weight: weight ?? 1,
    })),
  };
};
