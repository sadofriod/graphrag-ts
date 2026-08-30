import { describe, expect, it } from 'bun:test';

import { buildRAG, type BuildRagDeps } from './buildRag';

describe('buildRAG', () => {
  it('splits each file and feeds every edge, claim and entity into the pipeline', async () => {
    const splitCalls: Array<{ content: string; title: string; namespace: string }> = [];
    const buildEdgesCalls: Array<{ chunks: unknown[]; parentId: string; namespace: string }> = [];
    const buildClaimsCalls: Array<{
      claims: unknown[];
      opts: { parentId: string; childIds: readonly string[]; namespace: string };
    }> = [];
    const buildEntitiesCalls: Array<{ entities: unknown[]; namespace: string }> = [];
    let detectCalls = 0;

    const deps: BuildRagDeps = {
      split: async ({ content, title, namespace }) => {
        splitCalls.push({ content, title, namespace });
        return [
          {
            parentId: `p-${title}`,
            childIds: [`c-${title}-1`],
            edges: [{ source: 'A', target: 'B', relation: 'x' }],
            claims: [{ subject: 'A', object: 'B', description: 'desc', childIndex: 0 }],
            entities: [{ name: 'A', description: 'entity A' }],
          },
        ];
      },
      buildEdges: async (chunks, parentId, namespace) => {
        buildEdgesCalls.push({ chunks, parentId, namespace });
        return [];
      },
      buildClaims: async (claims, opts) => {
        buildClaimsCalls.push({ claims, opts });
        return claims.length;
      },
      buildEntities: async (entities, namespace) => {
        buildEntitiesCalls.push({ entities, namespace });
        return entities.length;
      },
      detectCommunity: async () => {
        detectCalls += 1;
        return {
          algorithm: 'leiden',
          communities: [{ id: 0, members: ['A', 'B'] }],
          membership: [0, 0],
          score: 1,
        };
      },
    };

    const summary = await buildRAG(
      [
        { title: 'a.md', content: 'aaa' },
        { title: 'b.txt', content: 'bbb' },
      ],
      'ns-a',
      deps,
    );

    expect(splitCalls).toEqual([
      { content: 'aaa', title: 'a.md', namespace: 'ns-a' },
      { content: 'bbb', title: 'b.txt', namespace: 'ns-a' },
    ]);
    expect(buildEdgesCalls).toEqual([
      {
        chunks: [{ source: 'A', target: 'B', relation: 'x', weight: 1 }],
        parentId: 'p-a.md',
        namespace: 'ns-a',
      },
      {
        chunks: [{ source: 'A', target: 'B', relation: 'x', weight: 1 }],
        parentId: 'p-b.txt',
        namespace: 'ns-a',
      },
    ]);
    expect(buildClaimsCalls).toEqual([
      {
        claims: [{ subject: 'A', object: 'B', description: 'desc', childIndex: 0 }],
        opts: { parentId: 'p-a.md', childIds: ['c-a.md-1'], namespace: 'ns-a' },
      },
      {
        claims: [{ subject: 'A', object: 'B', description: 'desc', childIndex: 0 }],
        opts: { parentId: 'p-b.txt', childIds: ['c-b.txt-1'], namespace: 'ns-a' },
      },
    ]);
    expect(buildEntitiesCalls).toEqual([
      { entities: [{ name: 'A', description: 'entity A' }], namespace: 'ns-a' },
      { entities: [{ name: 'A', description: 'entity A' }], namespace: 'ns-a' },
    ]);
    expect(detectCalls).toBe(1);
    expect(summary).toEqual({ files: 2, parents: 2, edges: 2, claims: 2, communities: 1 });
  });

  it('short-circuits on an empty file list without touching the pipeline', async () => {
    let touched = false;

    const deps: BuildRagDeps = {
      split: async () => {
        touched = true;
        return [];
      },
      buildEdges: async () => {
        touched = true;
        return [];
      },
      buildClaims: async () => {
        touched = true;
        return 0;
      },
      buildEntities: async () => {
        touched = true;
        return 0;
      },
      detectCommunity: async () => {
        touched = true;
        return {
          algorithm: 'leiden',
          communities: [],
          membership: [],
        };
      },
    };

    const summary = await buildRAG([], 'ns-a', deps);

    expect(summary).toEqual({ files: 0, parents: 0, edges: 0, claims: 0, communities: 0 });
    expect(touched).toBe(false);
  });
});
