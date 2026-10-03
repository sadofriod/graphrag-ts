import type { CommunityDetectionResult, WeightedGraphEdge } from '../detectCommunity';
import type { ChunkClaim } from '../helper/buildClaims';
import type { ChunkEdge } from '../helper/buildEdges';
import type { ChunkEntity } from '../helper/buildEntities';
import type { DocumentDiffSummary } from '../incremental/documentDiff';
import type { PruneDocumentResult } from '../incremental/documentPruner';
import type { SplitResult } from '../textSplit/types';

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
  incremental?: boolean | undefined;
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
  excludeFromCommunityDetection?: (parentIds: readonly string[], namespace: string) => Promise<void>;
  pruneDocuments?: (parentIds: readonly string[], namespace: string) => Promise<PruneDocumentResult>;
}

export interface IncrementalResolution {
  filesToProcess: readonly BuildInputFile[];
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  parentIdsToPrune: readonly string[];
}
