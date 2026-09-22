import type { CommunityDetectionResult, WeightedGraphEdge } from '../detectCommunity';
import type { ChunkClaim } from '../helper/buildClaims';
import type { ChunkEdge } from '../helper/buildEdges';
import type { ChunkEntity } from '../helper/buildEntities';
import type { DocumentDiffSummary } from '../incremental/documentDiff';
import type { PruneDocumentResult } from '../incremental/documentPruner';
import type { SplitResult } from '../textSplit';

export interface BuildInputFile {
  readonly title: string;
  readonly content: string;
}

export interface BuildSummary {
  readonly files: number;
  readonly parents: number;
  readonly edges: number;
  readonly claims: number;
  readonly communities: number;
  readonly insertedFiles?: number;
  readonly updatedFiles?: number;
  readonly skippedFiles?: number;
}

export interface BuildRagOptions {
  readonly incremental?: boolean | undefined;
}

export interface BuildRagDeps {
  readonly split: (input: { content: string; title: string; namespace: string }) => Promise<SplitResult[]>;
  readonly buildEdges: (chunks: ChunkEdge[], parentId: string, namespace: string) => Promise<unknown[]>;
  readonly buildClaims: (claims: ChunkClaim[], opts: {
    parentId: string;
    childIds: readonly string[];
    namespace: string;
  }) => Promise<number>;
  readonly buildEntities: (entities: ChunkEntity[], namespace: string) => Promise<number>;
  readonly detectCommunity: (options: {
    edges?: WeightedGraphEdge[];
    persistCommunitySummaries?: boolean;
    namespace: string;
  }) => Promise<CommunityDetectionResult>;
  readonly diffDocuments?: (files: readonly BuildInputFile[], namespace: string) => Promise<DocumentDiffSummary>;
  readonly excludeFromCommunityDetection?: (parentIds: readonly string[], namespace: string) => Promise<void>;
  readonly pruneDocuments?: (parentIds: readonly string[], namespace: string) => Promise<PruneDocumentResult>;
}

export interface IncrementalResolution {
  readonly filesToProcess: readonly BuildInputFile[];
  readonly insertedCount: number;
  readonly updatedCount: number;
  readonly skippedCount: number;
  readonly parentIdsToPrune: readonly string[];
}
