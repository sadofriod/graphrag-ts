import type { Pool } from 'pg';
import type { WorkspaceId } from './workspace.ts';

export type GraphSnapshot = {
  readonly versionId: string | null;
  readonly nodes: readonly {
    readonly id: string;
    readonly type: 'entity' | 'community';
    readonly label: string;
    readonly description: string;
    readonly level?: number;
  }[];
  readonly edges: readonly {
    readonly id: string;
    readonly source: string;
    readonly target: string;
    readonly label: string;
    readonly kind: 'relationship' | 'community-hierarchy' | 'community-member';
  }[];
};

type EntityRow = { id: string; name: string; description: string | null };
type CommunityRow = {
  id: string;
  community_name: string;
  summary_content: string;
  level: number;
  parent_community_id: string | null;
  members: string[];
};
type RelationshipRow = {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relationship_desc: string;
};

const createSnapshot = (
  versionId: string,
  entities: readonly EntityRow[],
  communities: readonly CommunityRow[],
  relationships: readonly RelationshipRow[],
): GraphSnapshot => {
  const nodes: GraphSnapshot['nodes'][number][] = [
    ...communities.map((community) => ({
      id: `community:${community.id}`,
      type: 'community' as const,
      label: community.community_name,
      description: community.summary_content,
      level: community.level,
    })),
    ...entities.map((entity) => ({
      id: `entity:${entity.id}`,
      type: 'entity' as const,
      label: entity.name,
      description: entity.description ?? '',
    })),
  ];
  const entityIdsByName = new Map(entities.map((entity) => [entity.name, `entity:${entity.id}`]));
  const communitiesWithChildren = new Set(
    communities.flatMap((community) => community.parent_community_id ? [community.parent_community_id] : []),
  );
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges: GraphSnapshot['edges'][number][] = [
    ...relationships.map((edge) => ({
      id: `relationship:${edge.id}`,
      source: `entity:${edge.source_entity_id}`,
      target: `entity:${edge.target_entity_id}`,
      label: edge.relationship_desc,
      kind: 'relationship' as const,
    })),
    ...communities.flatMap((community) => [
      ...(community.parent_community_id ? [{
        id: `hierarchy:${community.parent_community_id}:${community.id}`,
        source: `community:${community.parent_community_id}`,
        target: `community:${community.id}`,
        label: 'child community',
        kind: 'community-hierarchy' as const,
      }] : []),
      ...(!communitiesWithChildren.has(community.id) ? community.members.flatMap((member) => {
        const entityId = entityIdsByName.get(member);
        return entityId ? [{
          id: `member:${community.id}:${entityId}`,
          source: `community:${community.id}`,
          target: entityId,
          label: 'member',
          kind: 'community-member' as const,
        }] : [];
      }) : []),
    ]),
  ].filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));

  return { versionId, nodes, edges };
};

export const getGraphSnapshot = async (pool: Pool, workspaceId: WorkspaceId): Promise<GraphSnapshot> => {
  const active = await pool.query<{ id: string; namespace: string }>(
    `SELECT v.id, v.namespace FROM active_index a
     JOIN index_versions v ON v.id = a.version_id AND v.workspace_id = a.workspace_id
     WHERE a.workspace_id = $1`,
    [workspaceId],
  );
  const version = active.rows[0];
  if (!version) return { versionId: null, nodes: [], edges: [] };

  const [entities, communities, relationships] = await Promise.all([
    pool.query<EntityRow>(
      'SELECT id, name, description FROM rag_entities WHERE namespace = $1 ORDER BY name LIMIT 1000',
      [version.namespace],
    ),
    pool.query<CommunityRow>(
      `SELECT id, community_name, summary_content, level, parent_community_id, members
       FROM rag_community_summaries WHERE namespace = $1 ORDER BY level, community_name LIMIT 500`,
      [version.namespace],
    ),
    pool.query<RelationshipRow>(
      `SELECT id, source_entity_id, target_entity_id, relationship_desc
       FROM rag_graph_edges WHERE namespace = $1 ORDER BY id LIMIT 2500`,
      [version.namespace],
    ),
  ]);
  return createSnapshot(version.id, entities.rows, communities.rows, relationships.rows);
};
