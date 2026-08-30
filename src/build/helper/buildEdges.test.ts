import { describe, expect, it } from 'bun:test';

import { buildEdges, normalizeEdgeEntities } from './buildEdges';
import { prismaClient } from './prismaClient';

describe('normalizeEdgeEntities', () => {
  it('sorts source and target to a canonical order', () => {
    expect(normalizeEdgeEntities('Zulu', 'Alpha')).toEqual({
      sourceEntity: 'Alpha',
      targetEntity: 'Zulu',
    });
  });

  it('keeps the same pair stable when already ordered', () => {
    expect(normalizeEdgeEntities('Alpha', 'Zulu')).toEqual({
      sourceEntity: 'Alpha',
      targetEntity: 'Zulu',
    });
  });
});

describe('buildEdges', () => {
  it('upserts entity rows and then writes the canonical edge pair by entity ids', async () => {
    const originalEntityUpsert = prismaClient.rAGEntity.upsert;
    const originalEdgeUpsert = prismaClient.rAGGraphEdge.upsert;
    const entityUpsertCalls: unknown[] = [];
    const edgeUpsertCalls: unknown[] = [];

    prismaClient.rAGEntity.upsert = ((args: unknown) => {
      entityUpsertCalls.push(args);
      const { where } = args as { where: { namespace_name: { namespace: string; name: string } } };
      const name = where.namespace_name.name;
      return Promise.resolve({ id: name === 'Alpha' ? 'entity-alpha' : 'entity-zulu', name }) as never;
    }) as typeof prismaClient.rAGEntity.upsert;

    prismaClient.rAGGraphEdge.upsert = ((args: unknown) => {
      edgeUpsertCalls.push(args);
      return Promise.resolve({ id: 'edge-1' }) as never;
    }) as typeof prismaClient.rAGGraphEdge.upsert;

    try {
      await buildEdges(
        [{ source: 'Zulu', target: 'Alpha', relation: 'logs metrics', weight: 2 }],
        'parent-1',
        'ns-a',
      );

      expect(entityUpsertCalls).toEqual([
        { where: { namespace_name: { namespace: 'ns-a', name: 'Alpha' } }, update: {}, create: { namespace: 'ns-a', name: 'Alpha' } },
        { where: { namespace_name: { namespace: 'ns-a', name: 'Zulu' } }, update: {}, create: { namespace: 'ns-a', name: 'Zulu' } },
      ]);
      expect(edgeUpsertCalls).toHaveLength(1);
      expect(edgeUpsertCalls[0]).toMatchObject({
        where: {
          namespace_sourceEntityId_targetEntityId: {
            namespace: 'ns-a',
            sourceEntityId: 'entity-alpha',
            targetEntityId: 'entity-zulu',
          },
        },
        update: {
          parentId: 'parent-1',
          relationshipDesc: 'logs_metrics',
          weight: {
            increment: 2,
          },
        },
        create: {
          namespace: 'ns-a',
          sourceEntityId: 'entity-alpha',
          targetEntityId: 'entity-zulu',
          relationshipDesc: 'logs_metrics',
          parentId: 'parent-1',
          weight: 2,
        },
      });
    } finally {
      prismaClient.rAGEntity.upsert = originalEntityUpsert;
      prismaClient.rAGGraphEdge.upsert = originalEdgeUpsert;
    }
  });
});
