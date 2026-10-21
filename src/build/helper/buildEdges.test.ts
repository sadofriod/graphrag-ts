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
    }) as unknown as typeof prismaClient.rAGEntity.upsert;

    prismaClient.rAGGraphEdge.upsert = ((args: unknown) => {
      edgeUpsertCalls.push(args);
      return Promise.resolve({ id: 'edge-1' }) as never;
    }) as typeof prismaClient.rAGGraphEdge.upsert;

    try {
      await buildEdges(
        [{ source: 'Zulu', target: 'Alpha', relation: 'logs metrics', weight: 2 }],
        null,
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
          parentId: null,
          relationshipDesc: 'logs_metrics',
          weight: 2,
        },
        create: {
          namespace: 'ns-a',
          sourceEntityId: 'entity-alpha',
          targetEntityId: 'entity-zulu',
          relationshipDesc: 'logs_metrics',
          parentId: null,
          weight: 2,
        },
      });
    } finally {
      prismaClient.rAGEntity.upsert = originalEntityUpsert;
      prismaClient.rAGGraphEdge.upsert = originalEdgeUpsert;
    }
  });

  it('reuses the concurrently created entity after a unique-key upsert race', async () => {
    const originalEntityUpsert = prismaClient.rAGEntity.upsert;
    const originalEntityFindUnique = prismaClient.rAGEntity.findUnique;
    const originalEdgeUpsert = prismaClient.rAGGraphEdge.upsert;
    let alphaUpserted = false;
    const entityFinds: unknown[] = [];

    prismaClient.rAGEntity.upsert = ((args: unknown) => {
      const { where } = args as { where: { namespace_name: { namespace: string; name: string } } };
      const name = where.namespace_name.name;
      if (name === 'Alpha' && !alphaUpserted) {
        alphaUpserted = true;
        return Promise.reject(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }));
      }
      return Promise.resolve({ id: `entity-${name.toLowerCase()}`, name }) as never;
    }) as unknown as typeof prismaClient.rAGEntity.upsert;

    prismaClient.rAGEntity.findUnique = ((args: unknown) => {
      entityFinds.push(args);
      return Promise.resolve({ id: 'entity-alpha', name: 'Alpha' }) as never;
    }) as typeof prismaClient.rAGEntity.findUnique;

    prismaClient.rAGGraphEdge.upsert = (() => Promise.resolve({ id: 'edge-1' })) as never;

    try {
      await buildEdges([{ source: 'Alpha', target: 'Zulu', relation: 'related_to' }], null, 'ns-a');

      expect(entityFinds).toEqual([{
        where: { namespace_name: { namespace: 'ns-a', name: 'Alpha' } },
        select: { id: true },
      }]);
    } finally {
      prismaClient.rAGEntity.upsert = originalEntityUpsert;
      prismaClient.rAGEntity.findUnique = originalEntityFindUnique;
      prismaClient.rAGGraphEdge.upsert = originalEdgeUpsert;
    }
  });
});
