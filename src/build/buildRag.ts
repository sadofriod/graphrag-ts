import {
  detectCommunity,
  type CommunityDetectionResult,
  type WeightedGraphEdge,
} from './detectCommunity';
import { buildClaims, type ChunkClaim } from './helper/buildClaims';
import { buildEdges, type ChunkEdge } from './helper/buildEdges';
import { buildEntities, type ChunkEntity } from './helper/buildEntities';
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
}

const defaultDeps: BuildRagDeps = {
  split: (input) => textSplit(input),
  buildEdges: (chunks, parentId, namespace) => buildEdges(chunks, parentId, namespace),
  buildClaims: (claims, opts) => buildClaims(claims, opts),
  buildEntities: (entities, namespace) => buildEntities(entities, namespace),
  detectCommunity: (options) => detectCommunity(options),
};

export const buildRAG = async (
  files: readonly BuildInputFile[],
  namespace: string,
  deps: BuildRagDeps = defaultDeps,
): Promise<BuildSummary> => {
  if (files.length === 0) {
    return { files: 0, parents: 0, edges: 0, claims: 0, communities: 0 };
  }

  const splitResults = await Promise.all(
    files.map((file) => deps.split({ content: file.content, title: file.title, namespace })),
  );

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

  const communities = await deps.detectCommunity({ persistCommunitySummaries: true, namespace });

  return {
    files: files.length,
    parents,
    edges,
    claims,
    communities: communities.communities.length,
  };
};
