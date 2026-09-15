import { prismaClient } from '../helper/prismaClient';
import { withNamespace } from '../../namespace/namespaceContext';

export interface PruneDocumentResult {
  readonly deletedParents: number;
  readonly deletedClaims: number;
}

export const deleteDocumentByParentId = async (
  parentId: string,
  namespace: string,
): Promise<PruneDocumentResult> => pruneStaleDocuments([parentId], namespace);

export const deleteDocumentByTitle = async (
  title: string,
  namespace: string,
): Promise<PruneDocumentResult> =>
  withNamespace(namespace, async () => {
    const parents = await prismaClient.rAGParent.findMany({
      where: { title, namespace },
      select: { id: true },
    });

    if (parents.length === 0) {
      return { deletedParents: 0, deletedClaims: 0 };
    }

    return pruneStaleDocuments(parents.map((p) => p.id), namespace);
  });

export const pruneStaleDocuments = async (
  parentIds: readonly string[],
  namespace: string,
): Promise<PruneDocumentResult> =>
  withNamespace(namespace, async () => {
    if (parentIds.length === 0) {
      return { deletedParents: 0, deletedClaims: 0 };
    }

    await prismaClient.rAGClaim.updateMany({
      where: { sourceParentId: { in: [...parentIds] }, namespace },
      data: { sourceParentId: null },
    });

    await prismaClient.rAGGraphEdge.updateMany({
      where: { parentId: { in: [...parentIds] }, namespace },
      data: { parentId: null },
    });

    const parentDeleteResult = await prismaClient.rAGParent.deleteMany({
      where: { id: { in: [...parentIds] }, namespace },
    });

    return {
      deletedParents: parentDeleteResult.count,
      deletedClaims: 0,
    };
  });
