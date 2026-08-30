import type { WeightedGraphEdge } from '../../build/detectCommunity';
import { normalizeEdgeEntities, type GraphEdge } from '../../build/helper/buildEdges';
import type { EntityId } from '../types/graph';

/** @deprecated */
export function aggregateEdgeWeights(edges: readonly GraphEdge[]): WeightedGraphEdge[] {
  const weightMap = new Map<string, WeightedGraphEdge>();

  for (const edge of edges) {
    const { sourceEntity, targetEntity } = normalizeEdgeEntities(edge.source, edge.target);
    const key = `${sourceEntity}::${targetEntity}`;
    const existing = weightMap.get(key);

    if (existing) {
      existing.weight = (existing.weight ?? 1) + 1;
    } else {
      weightMap.set(key, { source: sourceEntity, target: targetEntity, weight: 1 });
    }
  }

  return Array.from(weightMap.values());
}

export function computeEdgeWeight(
  source: EntityId,
  target: EntityId,
  edges: readonly WeightedGraphEdge[],
): number {
  return edges.reduce((sum, edge) => {
    const connects =
      (edge.source === source && edge.target === target) ||
      (edge.source === target && edge.target === source);

    return connects ? sum + (edge.weight ?? 1) : sum;
  }, 0);
}

/** @deprecated */
export function normalizeScore(score: number): number {
  if (score <= 0) {
    return 0;
  }

  if (score >= 1) {
    return 1;
  }

  return score;
}
