import type { GraphEdge } from '../../build/helper/buildEdges';
import type { EntityId } from '../types/graph';

export function buildNeighborMap(edges: readonly GraphEdge[]): Map<EntityId, GraphEdge[]> {
  const neighborMap = new Map<EntityId, GraphEdge[]>();

  for (const edge of edges) {
    const sourceEdges = neighborMap.get(edge.source) ?? [];
    sourceEdges.push(edge);
    neighborMap.set(edge.source, sourceEdges);

    const targetEdges = neighborMap.get(edge.target) ?? [];
    targetEdges.push(edge);
    neighborMap.set(edge.target, targetEdges);
  }

  return neighborMap;
}

const neighborOf = (edge: GraphEdge, entityId: EntityId): EntityId =>
  edge.source === entityId ? edge.target : edge.source;

export function expandNeighbors(
  entityIds: readonly EntityId[],
  edges: readonly GraphEdge[],
  depth = 1,
): EntityId[] {
  const neighborMap = buildNeighborMap(edges);
  const visited = new Set<EntityId>(entityIds);
  const result: EntityId[] = [];
  let frontier: EntityId[] = [...entityIds];

  for (let level = 0; level < depth; level++) {
    const nextFrontier: EntityId[] = [];

    for (const current of frontier) {
      for (const edge of neighborMap.get(current) ?? []) {
        const neighbor = neighborOf(edge, current);
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          result.push(neighbor);
          nextFrontier.push(neighbor);
        }
      }
    }

    frontier = nextFrontier;
  }

  return result;
}
