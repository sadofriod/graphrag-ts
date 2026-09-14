import {
  detectCommunity,
  type CommunityDetectionResult,
  type WeightedGraphEdge,
} from './detectCommunity';
import { buildClaims, type ChunkClaim } from './helper/buildClaims';
import { buildEdges, type ChunkEdge } from './helper/buildEdges';
import { buildEntities, type ChunkEntity } from './helper/buildEntities';
import {
  diffDocuments,
  type DocumentDiffSummary,
} from './incremental/documentDiff';
import {
  pruneStaleDocuments,
  type PruneDocumentResult,
} from './incremental/documentPruner';
import { textSplit, type SplitResult } from './textSplit';

export interface BuildInputFile {
  title: string;
  content: string;
}

export interface BuildSummary {
  files: number;
  parents: number;
  edges: number;
  claims: number;
  communities: number;
  insertedFiles?: number;
  updatedFiles?: number;
  skippedFiles?: number;
}

export interface BuildRagOptions {
  readonly incremental?: boolean | undefined;
}

export interface BuildRagDeps {
  split: (input: { content: string; title: string; namespace: string }) => Promise<SplitResult[]>;
  buildEdges: (chunks: ChunkEdge[], parentId: string, namespace: string) => Promise<unknown[]>;
  buildClaims: (claims: ChunkClaim[], opts: {
    parentId: string;
    childIds: readonly string[];
    namespace: string;
  }) => Promise<number>;
  buildEntities: (entities: ChunkEntity[], namespace: string) => Promise<number>;
  detectCommunity: (options: {
    edges?: WeightedGraphEdge[];
    persistCommunitySummaries?: boolean;
    namespace: string;
  }) => Promise<CommunityDetectionResult>;
  diffDocuments?: (files: readonly BuildInputFile[], namespace: string) => Promise<DocumentDiffSummary>;
  pruneDocuments?: (parentIds: readonly string[], namespace: string) => Promise<PruneDocumentResult>;
}

const defaultDeps: BuildRagDeps = {
  split: (input) => textSplit(input),
  buildEdges: (chunks, parentId, namespace) => buildEdges(chunks, parentId, namespace),
  buildClaims: (claims, opts) => buildClaims(claims, opts),
  buildEntities: (entities, namespace) => buildEntities(entities, namespace),
  detectCommunity: (options) => detectCommunity(options),
  diffDocuments: (files, namespace) => diffDocuments(files, namespace),
  pruneDocuments: (parentIds, namespace) => pruneStaleDocuments(parentIds, namespace),
};

interface IncrementalResolution {
  readonly filesToProcess: readonly BuildInputFile[];
  readonly insertedCount: number;
  readonly updatedCount: number;
  readonly skippedCount: number;
}

const resolveIncrementalFiles = async (
  files: readonly BuildInputFile[],
  namespace: string,
  deps: BuildRagDeps,
): Promise<IncrementalResolution> => {
  if (!deps.diffDocuments) {
    return { filesToProcess: files, insertedCount: files.length, updatedCount: 0, skippedCount: 0 };
  }

  const diff = await deps.diffDocuments(files, namespace);
  if (diff.toUpdate.length > 0 && deps.pruneDocuments) {
    const parentIdsToPrune = diff.toUpdate
      .map((item) => item.existingParentId)
      .filter((id): id is string => typeof id === 'string');
    await deps.pruneDocuments(parentIdsToPrune, namespace);
  }

  const filesToProcess = [...diff.toInsert.map((i) => i.file), ...diff.toUpdate.map((u) => u.file)];
  return {
    filesToProcess,
    insertedCount: diff.toInsert.length,
    updatedCount: diff.toUpdate.length,
    skippedCount: diff.toSkip.length,
  };
};

const persistSplitResults = async (
  splitResults: readonly SplitResult[][],
  namespace: string,
  deps: BuildRagDeps,
) => {
  let parents = 0;
  let edges = 0;
  let claims = 0;

  for (const results of splitResults) {
    for (const result of results) {
      parents += 1;
      edges += result.edges.length;
      await deps.buildEdges(
        result.edges.map((edge) => ({ ...edge, weight: 1 })),
        result.parentId,
        namespace,
      );
      await deps.buildEntities(result.entities, namespace);
      claims += await deps.buildClaims(result.claims, {
        parentId: result.parentId,
        childIds: result.childIds,
        namespace,
      });
    }
  }

  return { parents, edges, claims };
};

export const buildRAG = async (
  files: readonly BuildInputFile[],
  namespace: string,
  deps: BuildRagDeps = defaultDeps,
  options: BuildRagOptions = {},
): Promise<BuildSummary> => {
  if (files.length === 0) {
    return { files: 0, parents: 0, edges: 0, claims: 0, communities: 0 };
  }

  const isIncremental = options.incremental ?? true;
  const resolution = isIncremental
    ? await resolveIncrementalFiles(files, namespace, deps)
    : { filesToProcess: files, insertedCount: files.length, updatedCount: 0, skippedCount: 0 };

  if (resolution.filesToProcess.length === 0) {
    return {
      files: files.length,
      parents: 0,
      edges: 0,
      claims: 0,
      communities: 0,
      insertedFiles: 0,
      updatedFiles: 0,
      skippedFiles: resolution.skippedCount,
    };
  }

  const splitResults = await Promise.all(
    resolution.filesToProcess.map((file) =>
      deps.split({ content: file.content, title: file.title, namespace }),
    ),
  );

  const graphStats = await persistSplitResults(splitResults, namespace, deps);
  const communities = await deps.detectCommunity({ persistCommunitySummaries: true, namespace });

  return {
    files: files.length,
    ...graphStats,
    communities: communities.communities.length,
    insertedFiles: resolution.insertedCount,
    updatedFiles: resolution.updatedCount,
    skippedFiles: resolution.skippedCount,
  };
};

export const buildIncrementalRAG = async (
  files: readonly BuildInputFile[],
  namespace: string,
  deps: BuildRagDeps = defaultDeps,
): Promise<BuildSummary> => buildRAG(files, namespace, deps, { incremental: true });

