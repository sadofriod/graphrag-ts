import { prismaClient } from './prismaClient';

export interface GraphEdge {
  source: string;
  target: string;
}

export interface ChunkEdge extends GraphEdge {
  relation: string;
  weight: number;
}

const normalizeRelation = (relation: string) =>
  relation.trim().toLowerCase().replace(/\s+/g, '_');

const normalizeWeight = (weight: number) => {
  if (!Number.isFinite(weight)) {
    return 1;
  }

  return Math.min(5, Math.max(1, Math.round(weight)));
};

export const normalizeEdgeEntities = (sourceEntity: string, targetEntity: string) => {
  const left = sourceEntity.trim();
  const right = targetEntity.trim();

  return left.localeCompare(right) <= 0
    ? { sourceEntity: left, targetEntity: right }
    : { sourceEntity: right, targetEntity: left };
};

interface AggregatedEdge {
  sourceEntity: string;
  targetEntity: string;
  relationshipDesc: string;
  weight: number;
  parentId: string | null;
}

/** Aggregate edges by normalized (source::target) pairs and accumulate weights. */
const aggregateEdges = (chunks: ChunkEdge[], parentId: string | null): AggregatedEdge[] => {
  const byPair = new Map<string, AggregatedEdge>();
  for (const { source, target, relation, weight } of chunks) {
    const { sourceEntity, targetEntity } = normalizeEdgeEntities(source, target);
    const key = `${sourceEntity}::${targetEntity}`;
    const current = byPair.get(key) ?? {
      sourceEntity,
      targetEntity,
      relationshipDesc: normalizeRelation(relation),
      weight: 0,
      parentId,
    };
    current.relationshipDesc = normalizeRelation(relation);
    current.parentId = parentId;
    current.weight += normalizeWeight(weight);
    byPair.set(key, current);
  }
  return [...byPair.values()];
};

/** Upsert all unique entities serially and resolve their ids to avoid unique-constraint conflicts when multiple edges share entities. */
const resolveEntities = async (
  edges: readonly AggregatedEdge[],
  namespace: string,
): Promise<Map<string, { id: string }>> => {
  const names = new Set<string>();
  for (const { sourceEntity, targetEntity } of edges) {
    names.add(sourceEntity);
    names.add(targetEntity);
  }

  const records = new Map<string, { id: string }>();
  for (const name of names) {
    const record = await prismaClient.rAGEntity.upsert({
      where: { namespace_name: { namespace, name } },
      update: {},
      create: { namespace, name },
    });
    records.set(name, record);
  }
  return records;
};

const upsertEdge = (
  edge: AggregatedEdge,
  entityRecords: ReadonlyMap<string, { id: string }>,
  parentId: string | null,
  namespace: string,
) => {
  const sourceRecord = entityRecords.get(edge.sourceEntity);
  const targetRecord = entityRecords.get(edge.targetEntity);
  if (!sourceRecord || !targetRecord) {
    throw new Error(`Entity record not found for edge ${edge.sourceEntity}->${edge.targetEntity}`);
  }

  return prismaClient.rAGGraphEdge.upsert({
    where: {
      namespace_sourceEntityId_targetEntityId: {
        namespace,
        sourceEntityId: sourceRecord.id,
        targetEntityId: targetRecord.id,
      },
    },
    update: {
      parentId,
      relationshipDesc: edge.relationshipDesc,
      weight: {
        increment: edge.weight,
      },
    },
    create: {
      namespace,
      sourceEntityId: sourceRecord.id,
      targetEntityId: targetRecord.id,
      relationshipDesc: edge.relationshipDesc,
      parentId,
      weight: edge.weight,
    },
  });
};

export const buildEdges = async (
  chunks: ChunkEdge[],
  parentId: string | null,
  namespace: string,
) => {
  if (chunks.length === 0) {
    return [];
  }

  const edges = aggregateEdges(chunks, parentId);
  const entityRecords = await resolveEntities(edges, namespace);
  return Promise.all(edges.map((edge) => upsertEdge(edge, entityRecords, parentId, namespace)));
};