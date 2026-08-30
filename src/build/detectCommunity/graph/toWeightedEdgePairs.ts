import type { WeightedGraphEdge } from '../types';

const normalizeEdgeWeight = (weight: number | undefined) => {
  const safeWeight = weight ?? 1;

  if (!Number.isFinite(safeWeight)) {
    return 1;
  }

  return Math.max(1, Math.round(safeWeight));
};

/** Flattens a weighted graph into vertex-index edge pairs, repeating an edge by its rounded weight. */
export const toWeightedEdgePairs = (edges: WeightedGraphEdge[]): Uint32Array => {
  const vertexOrder = Array.from(new Set(edges.flatMap(({ source, target }) => [source, target])));
  const vertexIds = new Map(vertexOrder.map((name, index) => [name, index]));

  const expandedEdges = edges.flatMap(({ source, target, weight }) => {
    const sourceId = vertexIds.get(source);
    const targetId = vertexIds.get(target);

    if (sourceId === undefined || targetId === undefined) {
      throw new Error(`Vertex not found in graph: ${sourceId === undefined ? source : target}`);
    }

    const multiplicity = normalizeEdgeWeight(weight);
    return Array.from({ length: multiplicity }, () => [sourceId, targetId] as const);
  });

  const pairs = new Uint32Array(expandedEdges.length * 2);
  expandedEdges.forEach(([sourceId, targetId], index) => {
    pairs[index * 2] = sourceId;
    pairs[index * 2 + 1] = targetId;
  });

  return pairs;
};
