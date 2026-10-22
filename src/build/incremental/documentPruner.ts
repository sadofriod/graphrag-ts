import { prismaClient } from '../helper/prismaClient';
import { withNamespace } from '../../namespace/namespaceContext';
import { removeParentEdgeContributions, withGraphWrite } from '../helper/edgeContributions';

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
  mutateDocumentGraph({ parentIds, namespace, deleteParents: true });

export const excludeDocumentsFromGraph = async (
  parentIds: readonly string[],
  namespace: string,
): Promise<void> => {
  await mutateDocumentGraph({ parentIds, namespace, deleteParents: false });
};

const mutateDocumentGraph = async ({ parentIds, namespace, deleteParents }: {
  readonly parentIds: readonly string[];
  readonly namespace: string;
  readonly deleteParents: boolean;
}): Promise<PruneDocumentResult> => {
  if (parentIds.length === 0) {
    return { deletedParents: 0, deletedClaims: 0 };
  }
  return withGraphWrite(namespace, async (transaction) => {
    await transaction.rAGClaim.updateMany({
      where: { sourceParentId: { in: [...parentIds] }, namespace },
      data: { sourceParentId: null, sourceChunkId: null, communitySummaryId: null },
    });

    await removeParentEdgeContributions(transaction, parentIds, namespace);
    if (!deleteParents) return { deletedParents: 0, deletedClaims: 0 };
    const parentDeleteResult = await transaction.rAGParent.deleteMany({
      where: { id: { in: [...parentIds] }, namespace },
    });

    return {
      deletedParents: parentDeleteResult.count,
      deletedClaims: 0,
    };
  });
};
