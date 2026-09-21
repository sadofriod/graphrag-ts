import {
  buildRAG,
  type BuildInputFile,
  type BuildRagDeps,
  type BuildRagOptions,
  type BuildSummary,
} from './buildRag';
import { buildClaims } from './helper/buildClaims';
import { buildEdges } from './helper/buildEdges';
import { buildEntities } from './helper/buildEntities';
import { detectCommunity } from './detectCommunity';
import { diffDocuments } from './incremental/documentDiff';
import {
  deleteDocumentByParentId,
  deleteDocumentByTitle,
  pruneStaleDocuments,
  type PruneDocumentResult,
} from './incremental/documentPruner';
import { withNamespace } from '../namespace/namespaceContext';
import { prismaClient } from './helper/prismaClient';
import { textSplit } from './textSplit';

export interface StartBuildOptions extends BuildRagOptions {
  runner?: (files: readonly BuildInputFile[], namespace: string) => Promise<BuildSummary>;
}

export interface DeleteDocumentInput {
  readonly title?: string;
  readonly parentId?: string;
  readonly namespace: string;
}

export const startBuild = (
  files: readonly BuildInputFile[],
  registry: BuildRegistry,
  namespace: string,
  options: StartBuildOptions = {},
): string => {
  const buildRagDeps: BuildRagDeps = {
    split: textSplit,
    buildEdges,
    buildClaims,
    buildEntities,
    detectCommunity,
    diffDocuments,
    excludeFromCommunityDetection: async (parentIds, namespace) => {
      await prismaClient.$transaction(async (tx) => {
        await tx.rAGClaim.updateMany({
          where: { sourceParentId: { in: [...parentIds] }, namespace },
          data: { sourceParentId: null },
        });

        await tx.rAGGraphEdge.updateMany({
          where: { parentId: { in: [...parentIds] }, namespace },
          data: { parentId: null },
        });
      });
    },
    pruneDocuments: pruneStaleDocuments,
  };

  const {
    runner = (f, ns) =>
      buildRAG(
        f,
        ns,
        buildRagDeps,
        options.incremental !== undefined ? { incremental: options.incremental } : {},
      ),
  } = options;
  const title = files.length === 1 ? (files[0]?.title ?? 'untitled') : `${files.length} files`;
  const id = registry.create({ title, namespace });

  void (async () => {
    registry.update(id, { status: 'running' });
    try {
      await withNamespace(namespace, () => runner(files, namespace));
      registry.update(id, { status: 'succeeded', finishedAt: Date.now() });
    } catch (error) {
      registry.update(id, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        finishedAt: Date.now(),
      });
    }
  })();

  return id;
};

export const startIncrementalBuild = (
  files: readonly BuildInputFile[],
  registry: BuildRegistry,
  namespace: string,
  options: Omit<StartBuildOptions, 'incremental'> = {},
): string => startBuild(files, registry, namespace, { ...options, incremental: true });

export const deleteRAGDocument = async (
  input: DeleteDocumentInput,
): Promise<PruneDocumentResult> =>
  withNamespace(input.namespace, async () => {
    if (input.parentId) {
      return deleteDocumentByParentId(input.parentId, input.namespace);
    }
    if (input.title) {
      return deleteDocumentByTitle(input.title, input.namespace);
    }
    return { deletedParents: 0, deletedClaims: 0 };
  });
