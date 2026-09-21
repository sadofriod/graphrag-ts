import { describe, expect, it } from 'bun:test';

import { getCurrentNamespace } from '../namespace/namespaceContext';
import {
  buildIncrementalRAG,
  buildRAG,
  type BuildRagDeps,
} from './buildRag';

describe('buildRAG incremental behavior', () => {
  it('returns early when all files are skipped in incremental mode', async () => {
    let splitCalled = false;

    const deps: BuildRagDeps = {
      split: async () => {
        splitCalled = true;
        return [];
      },
      buildEdges: async () => [],
      buildClaims: async () => 0,
      buildEntities: async () => 0,
      detectCommunity: async () => ({
        algorithm: 'leiden',
        communities: [],
        membership: [],
      }),
      diffDocuments: async (files) => ({
        toInsert: [],
        toUpdate: [],
        toSkip: files.map((f) => ({ file: f, action: 'skip', existingParentId: 'p-existing' })),
        all: [],
      }),
    };

    const summary = await buildRAG(
      [{ title: 'a.md', content: 'unchanged' }],
      'ns-a',
      deps,
      { incremental: true },
    );

    expect(splitCalled).toBe(false);
    expect(summary).toEqual({
      files: 1,
      parents: 0,
      edges: 0,
      claims: 0,
      communities: 0,
      insertedFiles: 0,
      updatedFiles: 0,
      skippedFiles: 1,
    });
  });

  it('does not prune updated documents before the replacement build succeeds', async () => {
    let pruneCalled = false;

    const deps: BuildRagDeps = {
      split: async () => [{ parentId: 'p-1', childIds: [], edges: [], claims: [], entities: [] }],
      buildEdges: async () => [],
      buildClaims: async () => 0,
      buildEntities: async () => 0,
      detectCommunity: async () => {
        throw new Error('community detection failed');
      },
      diffDocuments: async (files) => ({
        toInsert: [],
        toUpdate: [{
          file: files[0]!,
          action: 'update',
          existingParentId: 'old-p1',
          existingParentIds: ['old-p1'],
        }],
        toSkip: [],
        all: [],
      }),
      pruneDocuments: async () => {
        pruneCalled = true;
        return { deletedParents: 1, deletedClaims: 0 };
      },
    };

    await expect(buildRAG([{ title: 'a.md', content: 'updated' }], 'ns-a', deps, { incremental: true }))
      .rejects.toThrow('community detection failed');
    expect(pruneCalled).toBe(false);
  });

  it('establishes the namespace context for direct incremental builds', async () => {
    let diffNamespace: string | undefined;

    const deps: BuildRagDeps = {
      split: async () => [{ parentId: 'p-1', childIds: [], edges: [], claims: [], entities: [] }],
      buildEdges: async () => [],
      buildClaims: async () => 0,
      buildEntities: async () => 0,
      detectCommunity: async () => ({
        algorithm: 'leiden',
        communities: [],
        membership: [],
      }),
      diffDocuments: async () => {
        diffNamespace = getCurrentNamespace();
        return { toInsert: [], toUpdate: [], toSkip: [], all: [] };
      },
    };

    await buildIncrementalRAG([{ title: 'a.md', content: 'aaa' }], 'ns-a', deps);

    expect(diffNamespace).toBe('ns-a');
  });
});
