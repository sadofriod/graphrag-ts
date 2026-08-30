import { describe, expect, it } from 'bun:test';

import { buildEntities } from './buildEntities';
import { prismaClient } from './prismaClient';

describe('buildEntities', () => {
  const originalUpsert = prismaClient.rAGEntity.upsert;

  const stubUpsert = () => {
    const calls: Array<{
      where: { namespace_name: { namespace: string; name: string } };
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    }> = [];
    prismaClient.rAGEntity.upsert = ((args: unknown) => {
      calls.push(args as never);
      return Promise.resolve({ id: 'entity-1' }) as never;
    }) as typeof prismaClient.rAGEntity.upsert;
    return calls;
  };

  const restore = () => {
    prismaClient.rAGEntity.upsert = originalUpsert;
  };

  it('returns 0 without touching the db when there are no entities', async () => {
    const calls = stubUpsert();
    try {
      const count = await buildEntities([], 'ns-a');
      expect(count).toBe(0);
      expect(calls).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it('upserts entity descriptions last-write-wins under the namespace', async () => {
    const calls = stubUpsert();
    try {
      const count = await buildEntities(
        [
          { name: 'Alpha', description: 'leader' },
          { name: ' Beta ', description: '' },
        ],
        'ns-a',
      );
      expect(count).toBe(2);
      expect(calls).toEqual([
        {
          where: { namespace_name: { namespace: 'ns-a', name: 'Alpha' } },
          update: { description: 'leader' },
          create: { namespace: 'ns-a', name: 'Alpha', description: 'leader' },
        },
        {
          where: { namespace_name: { namespace: 'ns-a', name: 'Beta' } },
          update: {},
          create: { namespace: 'ns-a', name: 'Beta' },
        },
      ]);
    } finally {
      restore();
    }
  });

  it('skips blank entity names', async () => {
    const calls = stubUpsert();
    try {
      const count = await buildEntities([{ name: '  ' }], 'ns-a');
      expect(count).toBe(0);
      expect(calls).toHaveLength(0);
    } finally {
      restore();
    }
  });
});
