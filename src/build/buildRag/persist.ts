import type { BuildRagDeps } from './types';
import type { ChunkEdge, SplitResult } from '../textSplit';

const withWeight = (edge: ChunkEdge): ChunkEdge => ({ ...edge, weight: edge.weight ?? 1 });

const countResult = async (
  result: SplitResult,
  namespace: string,
  deps: BuildRagDeps,
): Promise<{ readonly parents: number; readonly edges: number; readonly claims: number }> => {
  const weightedEdges: ChunkEdge[] = result.edges.map(withWeight);
  const [persistedEdges, , claimCount] = await Promise.all([
    deps.buildEdges(weightedEdges, result.parentId, namespace),
    deps.buildEntities(result.entities, namespace),
    deps.buildClaims(result.claims, {
      parentId: result.parentId,
      childIds: result.childIds,
      namespace,
    }),
  ]);

  return {
    parents: 1,
    edges: persistedEdges.length,
    claims: claimCount,
  };
};

export const persistSplitResults = async (
  splitResults: readonly SplitResult[][],
  namespace: string,
  deps: BuildRagDeps,
): Promise<{ readonly parents: number; readonly edges: number; readonly claims: number }> => {
  const flatResults = splitResults.flat();
  const counts = await Promise.all(
    flatResults.map((result) => countResult(result, namespace, deps)),
  );

  return counts.reduce(
    (acc, item) => ({
      parents: acc.parents + item.parents,
      edges: acc.edges + item.edges,
      claims: acc.claims + item.claims,
    }),
    { parents: 0, edges: 0, claims: 0 },
  );
};
