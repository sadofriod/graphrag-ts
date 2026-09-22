import { describe, expect, it } from 'bun:test';

import type { BuildRegistry } from './buildRegistry';
import { createBuildRegistry } from './buildRegistry';
import { prismaClient } from './helper/prismaClient';
import { getCurrentNamespace } from '../namespace/namespaceContext';
import { startBuild, startIncrementalBuild, deleteRAGDocument } from './startBuild';

const waitForFinish = async (registry: BuildRegistry, id: string) => {
  for (let i = 0; i < 100; i += 1) {
    if (registry.get(id)?.status !== 'running') {
      return;
    }
    await Bun.sleep(1);
  }
};

describe('startBuild', () => {
  it('creates a running job and succeeds when the runner resolves', async () => {
    const registry = createBuildRegistry();
    let runnerFiles: unknown;
    let runnerNamespace: string | undefined;
    let runnerContextNamespace: string | undefined;

    const id = startBuild([{ title: 'a.md', content: 'x' }], registry, 'ns-a', {
      runner: async (files, namespace) => {
        runnerFiles = files;
        runnerNamespace = namespace;
        runnerContextNamespace = getCurrentNamespace();
        return { files: 1, parents: 1, edges: 0, claims: 0, communities: 0 };
      },
    });

    expect(registry.get(id)?.status).toBe('running');

    await waitForFinish(registry, id);

    expect(runnerFiles).toEqual([{ title: 'a.md', content: 'x' }]);
    expect(runnerNamespace).toBe('ns-a');
    expect(runnerContextNamespace).toBe('ns-a');
    expect(registry.get(id)?.status).toBe('succeeded');
    expect(registry.get(id)?.finishedAt).toBeTypeOf('number');
  });

  it('marks the job failed with the error message when the runner rejects', async () => {
    const registry = createBuildRegistry();

    const id = startBuild([{ title: 'a.md', content: 'x' }], registry, 'ns-a', {
      runner: async () => {
        throw new Error('LLM timeout');
      },
    });

    await waitForFinish(registry, id);

    expect(registry.get(id)?.status).toBe('failed');
    expect(registry.get(id)?.error).toBe('LLM timeout');
  });

  it('derives the job title from the single file name', () => {
    const registry = createBuildRegistry();

    const id = startBuild([{ title: 'doc.md', content: 'x' }], registry, 'ns-a', {
      runner: async () => ({ files: 1, parents: 0, edges: 0, claims: 0, communities: 0 }),
    });

    expect(registry.get(id)?.title).toBe('doc.md');
  });

  it('uses a pluralized title when multiple files are queued', () => {
    const registry = createBuildRegistry();

    const id = startBuild([
      { title: 'a.md', content: 'x' },
      { title: 'b.md', content: 'y' },
    ], registry, 'ns-a', {
      runner: async () => ({ files: 2, parents: 0, edges: 0, claims: 0, communities: 0 }),
    });

    expect(registry.get(id)?.title).toBe('2 files');
  });

  it('supports startIncrementalBuild shorthand', async () => {
    const registry = createBuildRegistry();
    let runnerCalled = false;

    const id = startIncrementalBuild([{ title: 'doc.md', content: 'x' }], registry, 'ns-a', {
      runner: async () => {
        runnerCalled = true;
        return { files: 1, parents: 1, edges: 0, claims: 0, communities: 0 };
      },
    });

    await waitForFinish(registry, id);
    expect(runnerCalled).toBe(true);
    expect(registry.get(id)?.status).toBe('succeeded');
  });

  it('deletes document via parent id', async () => {
    const originalParentDeleteMany = prismaClient.rAGParent.deleteMany;
    const originalClaimUpdateMany = prismaClient.rAGClaim.updateMany;
    const originalEdgeUpdateMany = prismaClient.rAGGraphEdge.updateMany;

    prismaClient.rAGParent.deleteMany = (() =>
      Promise.resolve({ count: 1 })) as typeof prismaClient.rAGParent.deleteMany;
    prismaClient.rAGClaim.updateMany = (() =>
      Promise.resolve({ count: 2 })) as typeof prismaClient.rAGClaim.updateMany;
    prismaClient.rAGGraphEdge.updateMany = (() =>
      Promise.resolve({ count: 1 })) as typeof prismaClient.rAGGraphEdge.updateMany;

    try {
      const result = await deleteRAGDocument({ parentId: 'p-1', namespace: 'ns-a' });
      expect(result).toEqual({ deletedParents: 1, deletedClaims: 0 });
    } finally {
      prismaClient.rAGParent.deleteMany = originalParentDeleteMany;
      prismaClient.rAGClaim.updateMany = originalClaimUpdateMany;
      prismaClient.rAGGraphEdge.updateMany = originalEdgeUpdateMany;
    }
  });

  it('deletes document via title when parent id is not provided', async () => {
    const originalFindMany = prismaClient.rAGParent.findMany;
    const originalParentDeleteMany = prismaClient.rAGParent.deleteMany;
    const originalClaimUpdateMany = prismaClient.rAGClaim.updateMany;
    const originalEdgeUpdateMany = prismaClient.rAGGraphEdge.updateMany;

    prismaClient.rAGParent.findMany = (() =>
      Promise.resolve([{ id: 'p-2' }])) as typeof prismaClient.rAGParent.findMany;
    prismaClient.rAGParent.deleteMany = (() =>
      Promise.resolve({ count: 1 })) as typeof prismaClient.rAGParent.deleteMany;
    prismaClient.rAGClaim.updateMany = (() =>
      Promise.resolve({ count: 0 })) as typeof prismaClient.rAGClaim.updateMany;
    prismaClient.rAGGraphEdge.updateMany = (() =>
      Promise.resolve({ count: 0 })) as typeof prismaClient.rAGGraphEdge.updateMany;

    try {
      const result = await deleteRAGDocument({ title: 'doc.md', namespace: 'ns-a' });
      expect(result).toEqual({ deletedParents: 1, deletedClaims: 0 });
    } finally {
      prismaClient.rAGParent.findMany = originalFindMany;
      prismaClient.rAGParent.deleteMany = originalParentDeleteMany;
      prismaClient.rAGClaim.updateMany = originalClaimUpdateMany;
      prismaClient.rAGGraphEdge.updateMany = originalEdgeUpdateMany;
    }
  });
});
