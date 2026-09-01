import { describe, expect, it } from 'bun:test';

import { prismaClient } from './helper/prismaClient';
import { createDbBuildRegistry } from './dbBuildRegistry';

describe('createDbBuildRegistry', () => {
  const originalCreate = prismaClient.generationJob.create;
  const originalUpdate = prismaClient.generationJob.update;

  interface Call {
    where?: unknown;
    data: Record<string, unknown>;
  }

  let createdCalls: Call[];
  let updatedCalls: Call[];

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  const stub = (options: { holdCreate?: () => Promise<unknown> } = {}) => {
    createdCalls = [];
    updatedCalls = [];
    prismaClient.generationJob.create = ((args: unknown) => {
      createdCalls.push(args as never);
      return (options.holdCreate ? options.holdCreate() : Promise.resolve(args)) as never;
    }) as typeof prismaClient.generationJob.create;
    prismaClient.generationJob.update = ((args: unknown) => {
      updatedCalls.push(args as never);
      return Promise.resolve(args) as never;
    }) as typeof prismaClient.generationJob.update;
  };

  const restore = () => {
    prismaClient.generationJob.create = originalCreate;
    prismaClient.generationJob.update = originalUpdate;
  };

  it('persists the create then updates in submission order', async () => {
    stub();
    try {
      const registry = createDbBuildRegistry();
      const id = registry.create({ title: 'main_narrative.md', namespace: 'ns-a' });
      registry.update(id, { status: 'running' });
      registry.update(id, { status: 'failed', error: 'boom', finishedAt: 1234 });
      await flush();

      expect(createdCalls).toHaveLength(1);
      expect(createdCalls[0]).toMatchObject({
        data: {
          id,
          namespace: 'ns-a',
          kind: 'ragBuild',
          title: 'main_narrative.md',
          state: 'pending',
          phase: 'processing',
        },
      });
      expect(updatedCalls).toHaveLength(2);
      expect(updatedCalls[0]).toMatchObject({ where: { id }, data: { state: 'running' } });
      expect(updatedCalls[1]).toMatchObject({
        where: { id },
        data: { state: 'failed', error: 'boom', finishedAt: new Date(1234) },
      });
    } finally {
      restore();
    }
  });

  it('defers the update until the create has resolved', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    stub({ holdCreate: () => gate });
    try {
      const registry = createDbBuildRegistry();
      const id = registry.create({ title: 'main_narrative.md', namespace: 'ns-a' });
      registry.update(id, { status: 'running' });

      await flush();
      expect(createdCalls).toHaveLength(1);
      // create 尚未提交时，update 不得提前执行
      expect(updatedCalls).toHaveLength(0);

      release();
      await flush();
      expect(updatedCalls).toHaveLength(1);
      expect(updatedCalls[0]).toMatchObject({ where: { id }, data: { state: 'running' } });
    } finally {
      restore();
    }
  });

  it('keeps the mirror in sync and ignores unknown ids', async () => {
    stub();
    try {
      const registry = createDbBuildRegistry();
      const id = registry.create({ title: 'main_narrative.md', namespace: 'ns-a' });
      expect(registry.get(id)?.status).toBe('pending');

      registry.update('does-not-exist', { status: 'failed' });
      await flush();
      expect(createdCalls).toHaveLength(1);
      expect(updatedCalls).toHaveLength(0);

      registry.update(id, { status: 'succeeded', finishedAt: 99 });
      expect(registry.get(id)?.status).toBe('succeeded');
      await flush();
      expect(updatedCalls).toHaveLength(1);
    } finally {
      restore();
    }
  });
});
