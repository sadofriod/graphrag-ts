import type { PoolClient } from 'pg';

const tables = [
  {
    table: 'rag_parents', map: 'snapshot_parent_ids',
    columns: 'id, namespace, title, content, created_at, updated_at',
    selection: 'ids.new_id, $2, source.title, source.content, source.created_at, source.updated_at',
    joins: '',
  },
  {
    table: 'rag_entities', map: 'snapshot_entity_ids',
    columns: 'id, namespace, name, description, created_at',
    selection: 'ids.new_id, $2, source.name, source.description, source.created_at',
    joins: '',
  },
  {
    table: 'rag_community_summaries', map: 'snapshot_summary_ids',
    columns: 'id, namespace, community_name, summary_content, summary_embedding, created_at, members, level, parent_community_id, content_fingerprint',
    selection: `ids.new_id, $2, source.community_name, source.summary_content, source.summary_embedding,
      source.created_at, source.members, source.level, parent_ids.new_id, source.content_fingerprint`,
    joins: 'LEFT JOIN snapshot_summary_ids parent_ids ON parent_ids.old_id = source.parent_community_id',
  },
  {
    table: 'rag_children', map: 'snapshot_child_ids',
    columns: 'id, namespace, content, created_at, updated_at, parent_id, embedding, fts_tokens',
    selection: 'ids.new_id, $2, source.content, source.created_at, source.updated_at, parent_ids.new_id, source.embedding, source.fts_tokens',
    joins: 'JOIN snapshot_parent_ids parent_ids ON parent_ids.old_id = source.parent_id',
  },
  {
    table: 'rag_graph_edges', map: 'snapshot_edge_ids',
    columns: 'id, namespace, parent_id, source_entity_id, target_entity_id, relationship_desc, weight, community_summary_id, created_at',
    selection: `ids.new_id, $2, parent_ids.new_id, source_ids.new_id, target_ids.new_id,
      source.relationship_desc, source.weight, summary_ids.new_id, source.created_at`,
    joins: `JOIN snapshot_entity_ids source_ids ON source_ids.old_id = source.source_entity_id
      JOIN snapshot_entity_ids target_ids ON target_ids.old_id = source.target_entity_id
      LEFT JOIN snapshot_parent_ids parent_ids ON parent_ids.old_id = source.parent_id
      LEFT JOIN snapshot_summary_ids summary_ids ON summary_ids.old_id = source.community_summary_id`,
  },
  {
    table: 'rag_claims', map: 'snapshot_claim_ids',
    columns: 'id, namespace, subject_entity_id, object_entity_id, description, description_hash, source_parent_id, source_chunk_id, community_summary_id, created_at',
    selection: `ids.new_id, $2, subject_ids.new_id, object_ids.new_id, source.description,
      source.description_hash, parent_ids.new_id, child_ids.new_id, summary_ids.new_id, source.created_at`,
    joins: `JOIN snapshot_entity_ids subject_ids ON subject_ids.old_id = source.subject_entity_id
      LEFT JOIN snapshot_entity_ids object_ids ON object_ids.old_id = source.object_entity_id
      LEFT JOIN snapshot_parent_ids parent_ids ON parent_ids.old_id = source.source_parent_id
      LEFT JOIN snapshot_child_ids child_ids ON child_ids.old_id = source.source_chunk_id
      LEFT JOIN snapshot_summary_ids summary_ids ON summary_ids.old_id = source.community_summary_id`,
  },
] as const;

export const cloneGraphNamespace = async (
  client: PoolClient,
  sourceNamespace: string,
  targetNamespace: string,
): Promise<void> => {
  if (sourceNamespace === targetNamespace) throw new Error('Snapshot clone requires a different namespace.');
  for (const { table, map } of tables) {
    await client.query(`CREATE TEMP TABLE ${map} (old_id TEXT PRIMARY KEY, new_id TEXT NOT NULL) ON COMMIT DROP`);
    await client.query(
      `INSERT INTO ${map} SELECT id, gen_random_uuid()::text FROM ${table} WHERE namespace = $1`,
      [sourceNamespace],
    );
  }
  for (const { table, map, columns, selection, joins } of tables) {
    await client.query(
      `INSERT INTO ${table} (${columns}) SELECT ${selection}
       FROM ${table} source JOIN ${map} ids ON ids.old_id = source.id ${joins}
       WHERE source.namespace = $1`,
      [sourceNamespace, targetNamespace],
    );
  }
  await client.query(
    `INSERT INTO rag_edge_contributions (namespace, edge_id, parent_id, weight, relationship_desc)
     SELECT $2, edge_ids.new_id, parent_ids.new_id, source.weight, source.relationship_desc
     FROM rag_edge_contributions source
     JOIN snapshot_edge_ids edge_ids ON edge_ids.old_id = source.edge_id
     JOIN snapshot_parent_ids parent_ids ON parent_ids.old_id = source.parent_id
     WHERE source.namespace = $1`,
    [sourceNamespace, targetNamespace],
  );
};