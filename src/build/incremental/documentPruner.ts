import { prismaClient } from '../helper/prismaClient';

export interface PruneDocumentResult {
  readonly deletedParents: number;
  readonly deletedClaims: number;
}

export const deleteDocumentByParentId = async (
  parentId: string,
  namespace: string,
): Promise<PruneDocumentResult> => {
  const claimDeleteResult = await prismaClient.rAGClaim.deleteMany({
    where: { sourceParentId: parentId, namespace },
  });

  const parentDeleteResult = await prismaClient.rAGParent.deleteMany({
    where: { id: parentId, namespace },
  });

  return {
    deletedParents: parentDeleteResult.count,
    deletedClaims: claimDeleteResult.count,
  };
};

export const deleteDocumentByTitle = async (
  title: string,
  namespace: string,
): Promise<PruneDocumentResult> => {
  const parents = await prismaClient.rAGParent.findMany({
    where: { title, namespace },
    select: { id: true },
  });

  if (parents.length === 0) {
    return { deletedParents: 0, deletedClaims: 0 };
  }

  const parentIds = parents.map((p) => p.id);

  const claimDeleteResult = await prismaClient.rAGClaim.deleteMany({
    where: { sourceParentId: { in: parentIds }, namespace },
  });

  const parentDeleteResult = await prismaClient.rAGParent.deleteMany({
    where: { id: { in: parentIds }, namespace },
  });

  return {
    deletedParents: parentDeleteResult.count,
    deletedClaims: claimDeleteResult.count,
  };
};

export const pruneStaleDocuments = async (
  parentIds: readonly string[],
  namespace: string,
): Promise<PruneDocumentResult> => {
  if (parentIds.length === 0) {
    return { deletedParents: 0, deletedClaims: 0 };
  }

  const claimDeleteResult = await prismaClient.rAGClaim.deleteMany({
    where: { sourceParentId: { in: [...parentIds] }, namespace },
  });

  const parentDeleteResult = await prismaClient.rAGParent.deleteMany({
    where: { id: { in: [...parentIds] }, namespace },
  });

  return {
    deletedParents: parentDeleteResult.count,
    deletedClaims: claimDeleteResult.count,
  };
};
