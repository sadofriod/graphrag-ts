import { describe, expect, it } from 'bun:test';

import { buildClaims, descriptionHash } from './buildClaims';
import { prismaClient } from './prismaClient';

describe('descriptionHash', () => {
  it('is a 64-char sha256 hex over trimmed lowercase text', () => {
    const hash = descriptionHash('  Hello World  ');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(descriptionHash('hello world'));
    // 不折叠空格：不同措辞不合并
    expect(hash).not.toBe(descriptionHash('hello  world'));
  });
});

describe('buildClaims', () => {
  const originalEntityUpsert = prismaClient.rAGEntity.upsert;
  const originalCreateMany = prismaClient.rAGClaim.createMany;

  const stubEntityUpsert = () => {
    const calls: Array<{ where: { namespace_name: { namespace: string; name: string } } }> = [];
    prismaClient.rAGEntity.upsert = ((args: unknown) => {
      calls.push(args as never);
      const { where } = args as { where: { namespace_name: { namespace: string; name: string } } };
      return Promise.resolve({ id: `entity-${where.namespace_name.name}` }) as never;
    }) as typeof prismaClient.rAGEntity.upsert;
    return calls;
  };

  const stubCreateMany = () => {
    const calls: Array<{ data: unknown[]; skipDuplicates?: boolean }> = [];
    prismaClient.rAGClaim.createMany = ((args: unknown) => {
      const { data, skipDuplicates } = args as { data: unknown[]; skipDuplicates?: boolean };
      calls.push(skipDuplicates === undefined ? { data } : { data, skipDuplicates });
      return Promise.resolve({ count: data.length }) as never;
    }) as typeof prismaClient.rAGClaim.createMany;
    return calls;
  };

  const restore = () => {
    prismaClient.rAGEntity.upsert = originalEntityUpsert;
    prismaClient.rAGClaim.createMany = originalCreateMany;
  };

  it('returns 0 without touching the db when there are no claims', async () => {
    const entityCalls = stubEntityUpsert();
    const createCalls = stubCreateMany();
    try {
      const count = await buildClaims([], { parentId: 'p', childIds: ['c'], namespace: 'ns-a' });
      expect(count).toBe(0);
      expect(entityCalls).toHaveLength(0);
      expect(createCalls).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it('upserts subject and object entities and maps childIndex to sourceChunkId', async () => {
    const entityCalls = stubEntityUpsert();
    const createCalls = stubCreateMany();
    try {
      const count = await buildClaims(
        [
          { subject: 'Alpha', object: 'Beta', description: 'Alpha leads Beta', childIndex: 1 },
          { subject: 'Gamma', description: 'Gamma is standalone' },
        ],
        { parentId: 'parent-1', childIds: ['child-0', 'child-1', 'child-2'], namespace: 'ns-a' },
      );

      expect(count).toBe(2);
      const names = entityCalls.map((c) => c.where.namespace_name.name);
      expect(names.sort()).toEqual(['Alpha', 'Beta', 'Gamma']);
      expect(entityCalls.every((c) => c.where.namespace_name.namespace === 'ns-a')).toBe(true);

      const data = createCalls[0]?.data as Array<Record<string, unknown>>;
      expect(data[0]).toMatchObject({
        namespace: 'ns-a',
        subjectEntityId: 'entity-Alpha',
        objectEntityId: 'entity-Beta',
        description: 'Alpha leads Beta',
        sourceParentId: 'parent-1',
        sourceChunkId: 'child-1',
      });
      expect(data[1]).toMatchObject({
        subjectEntityId: 'entity-Gamma',
      });
      expect(data[1]).not.toHaveProperty('objectEntityId');
      expect(data[1]).not.toHaveProperty('sourceChunkId');
    } finally {
      restore();
    }
  });

  it('drops out-of-range childIndex to parent-level traceability', async () => {
    stubEntityUpsert();
    const createCalls = stubCreateMany();
    try {
      await buildClaims(
        [{ subject: 'Alpha', description: 'fact', childIndex: 99 }],
        { parentId: 'parent-1', childIds: ['child-0'], namespace: 'ns-a' },
      );
      const data = createCalls[0]?.data as Array<Record<string, unknown>>;
      expect(data[0]).not.toHaveProperty('sourceChunkId');
    } finally {
      restore();
    }
  });

  it('emits identical description hashes for duplicate facts so the db can dedupe', async () => {
    stubEntityUpsert();
    const createCalls = stubCreateMany();
    try {
      await buildClaims(
        [
          { subject: 'Alpha', description: 'Alpha 是主角' },
          { subject: 'Alpha', description: 'Alpha 是主角' },
          { subject: 'Alpha', description: 'alpha 是主角' },
        ],
        { parentId: 'parent-1', childIds: [], namespace: 'ns-a' },
      );
      const data = createCalls[0]?.data as Array<Record<string, unknown>>;
      expect(data).toHaveLength(3);
      const hashes = new Set(data.map((row) => row.descriptionHash));
      expect(hashes.size).toBe(1);
      expect(createCalls[0]?.skipDuplicates).toBe(true);
    } finally {
      restore();
    }
  });
});
