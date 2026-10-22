import type { BuildRagDeps } from './types';
import type { ChunkEdge, SplitResult } from '../textSplit/types';

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
  return flatResults.reduce<Promise<{ readonly parents: number; readonly edges: number; readonly claims: number }>>(
    async (accPromise, result) => {
      const acc = await accPromise;
      const item = await countResult(result, namespace, deps);
      return {
        parents: acc.parents + item.parents,
        edges: acc.edges + item.edges,
        claims: acc.claims + item.claims,
      };
    },
    Promise.resolve({ parents: 0, edges: 0, claims: 0 }),
  );
};
