import { MarkerType, Position, type Edge, type Node } from '@xyflow/react';
import type { GraphSnapshot } from './useWorkspaceDashboard';

const NODE_HEIGHT = 58;
const VERTICAL_GAP = 104;
const HORIZONTAL_GAP = 260;

type PositionedGraph = { readonly nodes: Node[]; readonly edges: Edge[] };

type Branch = { readonly id: string; readonly side: number; readonly leaves: number };
type LayoutData = {
  readonly communities: GraphSnapshot['nodes'][number][];
  readonly entities: GraphSnapshot['nodes'][number][];
  readonly children: Map<string, string[]>;
  readonly members: Map<string, string[]>;
  readonly entityParents: Map<string, string>;
  readonly branches: Branch[];
  readonly orphanEntities: GraphSnapshot['nodes'][number][];
  readonly sideHeights: Map<number, number>;
  readonly countLeaves: (communityId: string, ancestors?: Set<string>) => number;
};

const prepareLayout = (graph: GraphSnapshot): LayoutData => {
  const communities = graph.nodes.filter((node) => node.type === 'community');
  const entities = graph.nodes.filter((node) => node.type === 'entity');
  const communityIds = new Set(communities.map((node) => node.id));
  const entityIds = new Set(entities.map((node) => node.id));
  const children = new Map<string, string[]>();
  const members = new Map<string, string[]>();
  const entityParents = new Map<string, string>();
  const childCommunityIds = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.kind === 'community-hierarchy' && communityIds.has(edge.source) && communityIds.has(edge.target)) {
      children.set(edge.source, [...(children.get(edge.source) ?? []), edge.target]);
      childCommunityIds.add(edge.target);
    }
    if (edge.kind === 'community-member' && communityIds.has(edge.source) && entityIds.has(edge.target)) {
      members.set(edge.source, [...(members.get(edge.source) ?? []), edge.target]);
      if (!entityParents.has(edge.target)) entityParents.set(edge.target, edge.source);
    }
  }

  const countLeaves = (communityId: string, ancestors = new Set<string>()): number => {
    if (ancestors.has(communityId)) return 1;
    const nextAncestors = new Set(ancestors).add(communityId);
    const childIds = children.get(communityId) ?? [];
    if (childIds.length) return childIds.reduce((sum, id) => sum + countLeaves(id, nextAncestors), 0);
    const leafMembers = (members.get(communityId) ?? [])
      .filter((entityId) => entityParents.get(entityId) === communityId);
    return Math.max(1, leafMembers.length);
  };
  let roots = communities.filter((community) => !childCommunityIds.has(community.id));
  if (roots.length === 0) roots = communities;
  const branches = roots.map((root, index) => ({
    id: root.id,
    side: index % 2 === 0 ? 1 : -1,
    leaves: countLeaves(root.id),
  }));
  const orphanEntities = entities.filter((entity) => !entityParents.has(entity.id));
  const sideHeights = new Map([
    [1, (branches.filter((branch) => branch.side === 1).reduce((sum, branch) => sum + branch.leaves, orphanEntities.length)) * VERTICAL_GAP],
    [-1, branches.filter((branch) => branch.side === -1).reduce((sum, branch) => sum + branch.leaves, 0) * VERTICAL_GAP],
  ]);
  return { communities, entities, children, members, entityParents, branches, orphanEntities, sideHeights, countLeaves };
};

const positionNodes = (layout: LayoutData, workspaceId: string): Map<string, { x: number; y: number }> => {
  const { children, members, entityParents, branches, orphanEntities, sideHeights, countLeaves } = layout;
  const positions = new Map<string, { x: number; y: number }>();
  const rootId = `workspace-root:${workspaceId}`;
  positions.set(rootId, { x: -90, y: -NODE_HEIGHT / 2 });

  const layoutCommunity = (
    communityId: string,
    depth: number,
    side: number,
    firstLeafY: number,
    ancestors = new Set<string>(),
  ): void => {
    if (ancestors.has(communityId)) return;
    const leafCount = countLeaves(communityId, ancestors);
    positions.set(communityId, {
      x: side * depth * HORIZONTAL_GAP - 95,
      y: firstLeafY + ((leafCount - 1) * VERTICAL_GAP) / 2 - NODE_HEIGHT / 2,
    });
    const nextAncestors = new Set(ancestors).add(communityId);
    const childIds = children.get(communityId) ?? [];
    if (childIds.length) {
      let cursor = firstLeafY;
      for (const childId of childIds) {
        const childLeaves = countLeaves(childId, nextAncestors);
        layoutCommunity(childId, depth + 1, side, cursor, nextAncestors);
        cursor += childLeaves * VERTICAL_GAP;
      }
      return;
    }
    let cursor = firstLeafY;
    const leafMembers = (members.get(communityId) ?? [])
      .filter((entityId) => entityParents.get(entityId) === communityId);
    for (const entityId of leafMembers) {
      positions.set(entityId, {
        x: side * (depth + 1) * HORIZONTAL_GAP - 95,
        y: cursor - NODE_HEIGHT / 2,
      });
      cursor += VERTICAL_GAP;
    }
  };

  for (const side of [1, -1]) {
    let cursor = -(sideHeights.get(side) ?? 0) / 2 + VERTICAL_GAP / 2;
    for (const branch of branches.filter((item) => item.side === side)) {
      layoutCommunity(branch.id, 1, side, cursor);
      cursor += branch.leaves * VERTICAL_GAP;
    }
    if (side === 1) {
      for (const entity of orphanEntities) {
        positions.set(entity.id, { x: HORIZONTAL_GAP - NODE_HEIGHT, y: cursor - NODE_HEIGHT / 2 });
        cursor += VERTICAL_GAP;
      }
    }
  }
  return positions;
};

const createNodes = (
  graph: GraphSnapshot,
  workspaceId: string,
  positions: Map<string, { x: number; y: number }>,
): Node[] => {
  const rootId = `workspace-root:${workspaceId}`;
  return [
    {
      id: rootId,
      position: positions.get(rootId) ?? { x: -90, y: -NODE_HEIGHT / 2 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: { label: workspaceId },
      style: {
        width: 180,
        minHeight: NODE_HEIGHT,
        borderRadius: 6,
        border: '1px solid #10503e',
        background: '#10503e',
        color: '#f4faf4',
        fontSize: 13,
        fontWeight: 750,
        padding: 14,
      },
    },
    ...graph.nodes.flatMap((node): Node[] => {
      const position = positions.get(node.id);
      if (!position) return [];
      const isCommunity = node.type === 'community';
      const isLeft = position.x < 0;
      return [{
        id: node.id,
        position,
        sourcePosition: isLeft ? Position.Left : Position.Right,
        targetPosition: isLeft ? Position.Right : Position.Left,
        data: { label: node.label },
        style: {
          width: 190,
          minHeight: NODE_HEIGHT,
          borderRadius: 5,
          border: isCommunity ? '1px solid #b8d4c1' : '1px solid #d6dcd5',
          background: isCommunity ? '#e4f1e7' : '#fffefa',
          color: '#202d29',
          fontSize: 12,
          fontWeight: isCommunity ? 700 : 600,
          padding: 12,
        },
      }];
    }),
  ];
};

const createEdges = (
  graph: GraphSnapshot,
  workspaceId: string,
  layout: LayoutData,
  nodes: readonly Node[],
): Edge[] => {
  const { branches, orphanEntities } = layout;
  const rootId = `workspace-root:${workspaceId}`;
  const visibleIds = new Set(nodes.map((node) => node.id));
  const directedEdges: Edge[] = graph.edges.flatMap((edge) => {
    if (!visibleIds.has(edge.source) || !visibleIds.has(edge.target)) return [];
    const isRelationship = edge.kind === 'relationship';
    const color = isRelationship ? '#c45a3d' : '#6c9c7a';
    return [{
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label.length > 38 ? `${edge.label.slice(0, 35)}...` : edge.label,
      type: 'smoothstep',
      markerEnd: { type: MarkerType.ArrowClosed, color },
      style: { stroke: color, strokeWidth: isRelationship ? 1.4 : 1.7 },
      labelStyle: { fill: '#52645a', fontSize: 9 },
      labelBgStyle: { fill: '#f8f9f4', fillOpacity: 0.92 },
    }];
  });
  const rootEdges: Edge[] = [
    ...branches.map((branch) => ({
      id: `workspace-branch:${workspaceId}:${branch.id}`,
      source: rootId,
      target: branch.id,
      label: 'community',
      type: 'smoothstep',
      markerEnd: { type: MarkerType.ArrowClosed, color: '#6c9c7a' },
      style: { stroke: '#6c9c7a', strokeWidth: 1.7 },
    })),
    ...orphanEntities.map((entity) => ({
      id: `workspace-entity:${workspaceId}:${entity.id}`,
      source: rootId,
      target: entity.id,
      label: 'entity',
      type: 'smoothstep',
      markerEnd: { type: MarkerType.ArrowClosed, color: '#6c9c7a' },
      style: { stroke: '#6c9c7a', strokeWidth: 1.7 },
    })),
  ];
  return [...rootEdges, ...directedEdges];
};

export const layoutMindmap = (graph: GraphSnapshot, workspaceId: string): PositionedGraph => {
  const layout = prepareLayout(graph);
  const positions = positionNodes(layout, workspaceId);
  const nodes = createNodes(graph, workspaceId, positions);
  return { nodes, edges: createEdges(graph, workspaceId, layout, nodes) };
};