import { describe, expect, it } from 'bun:test';

import { buildRAG, type BuildRagDeps } from './buildRag';

describe('buildRAG fact regression', () => {
  it('keeps updated facts consistent between incremental and fresh builds', async () => {
    const runBuild = async (incremental: boolean) => {
      const persistedClaims: string[] = [];
      const persistedEdges: string[] = [];
      const deps: BuildRagDeps = {
        split: async ({ content }) => [{
          parentId: `parent-${content}`,
          childIds: [`child-${content}`],
          edges: [{ source: 'Company A', target: 'Company B', relation: 'agreement' }],
          claims: [{ subject: 'Company A', object: 'Company B', description: content, childIndex: 0 }],
          entities: [],
        }],
        buildEdges: async (edges) => {
          persistedEdges.push(...edges.map((edge) => `${edge.source}->${edge.target}:${edge.relation}`));
          return edges.map((_, index) => ({ id: `edge-${index}` }));
        },
        buildClaims: async (claims) => {
          persistedClaims.push(...claims.map((claim) => claim.description));
          return claims.length;
        },
        buildEntities: async () => 0,
        detectCommunity: async () => ({
          algorithm: 'leiden',
          communities: [{ id: 0, members: ['Company A', 'Company B'] }],
          membership: [0, 0],
        }),
        ...(incremental ? {
          diffDocuments: async () => ({
            toInsert: [],
            toUpdate: [{
              file: { title: 'agreement.md', content: 'The agreement date is 2025-02-01' },
              action: 'update' as const,
              existingParentId: 'old-parent',
              existingParentIds: ['old-parent'],
            }],
            toSkip: [],
            all: [],
          }),
        } : {}),
      };

      await buildRAG(
        [{ title: 'agreement.md', content: 'The agreement date is 2025-02-01' }],
        'ns-a',
        deps,
        incremental ? { incremental: true } : {},
      );

      return { persistedClaims, persistedEdges };
    };

    const incrementalBuild = await runBuild(true);
    const freshBuild = await runBuild(false);

    expect(incrementalBuild).toEqual(freshBuild);
    expect(incrementalBuild.persistedClaims).toEqual(['The agreement date is 2025-02-01']);
    expect(incrementalBuild.persistedEdges).toEqual(['Company A->Company B:agreement']);
  });
});