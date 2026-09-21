import { describe, expect, it } from 'bun:test';

import { prismaClient } from '../../helper/prismaClient';
import { modelLoaderSingleton } from '../../modelLoader';
import { persistCommunitySummaries } from './persistCommunitySummaries';
import type { CommunityDetectionResult } from '../types';

describe('persistCommunitySummaries', () => {
  const entityProfileClient = prismaClient as unknown as {
    entityProfile?: {
      findMany: (...args: unknown[]) => unknown;
    };
  };
  const originalModels = modelLoaderSingleton.models;
  const originalSummaryCreate = prismaClient.rAGCommunitySummary.create;
  const originalSummaryFindMany = prismaClient.rAGCommunitySummary.findMany;
  const originalSummaryDeleteMany = prismaClient.rAGCommunitySummary.deleteMany;
  const originalEdgeFindMany = prismaClient.rAGGraphEdge.findMany;
  const originalClaimFindMany = prismaClient.rAGClaim.findMany;
  const originalEntityFindMany = prismaClient.rAGEntity.findMany;
  const originalProfileFindMany = entityProfileClient.entityProfile?.findMany;
  const originalEdgeUpdate = prismaClient.rAGGraphEdge.update;
  const originalClaimUpdate = prismaClient.rAGClaim.update;
  const originalExecuteRaw = prismaClient.$executeRaw;

  const result: CommunityDetectionResult = {
    algorithm: 'leiden',
    membership: [0, 0, 1],
    communities: [
      { id: 0, members: ['A', 'B'] },
      { id: 1, members: ['C'] },
    ],
  };

  it('persists a summary per community and backfills edge and claim assignments', async () => {
    const summaryCreateCalls: unknown[] = [];
    const edgeUpdateCalls: unknown[] = [];
    const claimUpdateCalls: unknown[] = [];
    const executeRawCalls: unknown[] = [];
    const edgeFindManyCalls: unknown[] = [];
    const claimFindManyCalls: unknown[] = [];
    const entityFindManyCalls: unknown[] = [];
    const profileFindManyCalls: unknown[] = [];
    const summaryFindManyCalls: unknown[] = [];

    modelLoaderSingleton.models = {
      embedding: { embedQuery: async () => [0.1, 0.2] },
      slice: {
        invoke: async () => JSON.stringify({ communityName: 'n', summaryContent: 's' }),
      },
    } as any;

    prismaClient.rAGGraphEdge.findMany = ((args: unknown) => {
      edgeFindManyCalls.push(args);
      return Promise.resolve([
        { id: 'edge-ab', sourceEntity: { name: 'A' }, targetEntity: { name: 'B' }, weight: 2 },
        { id: 'edge-ac', sourceEntity: { name: 'A' }, targetEntity: { name: 'C' }, weight: 1 },
      ]) as never;
    }) as typeof prismaClient.rAGGraphEdge.findMany;

    prismaClient.rAGClaim.findMany = ((args: unknown) => {
      claimFindManyCalls.push(args);
      return Promise.resolve([
        { id: 'claim-a', subjectEntity: { name: 'A' }, objectEntity: null, description: 'd' },
      ]) as never;
    }) as typeof prismaClient.rAGClaim.findMany;

    prismaClient.rAGEntity.findMany = ((args: unknown) => {
      entityFindManyCalls.push(args);
      return Promise.resolve([]) as never;
    }) as typeof prismaClient.rAGEntity.findMany;

    entityProfileClient.entityProfile = {
      findMany: (((args: unknown) => {
        profileFindManyCalls.push(args);
        return Promise.resolve([]) as never;
      }) as unknown) as () => Promise<never>,
    };

    prismaClient.rAGCommunitySummary.findMany = ((args: unknown) => {
      summaryFindManyCalls.push(args);
      return Promise.resolve([]) as never;
    }) as typeof prismaClient.rAGCommunitySummary.findMany;

    prismaClient.rAGCommunitySummary.create = ((args: unknown) => {
      summaryCreateCalls.push(args);
      const data = (args as { data?: Record<string, unknown> }).data ?? {};
      return Promise.resolve({
        id: `summary-${summaryCreateCalls.length}`,
        ...data,
      }) as never;
    }) as typeof prismaClient.rAGCommunitySummary.create;

    prismaClient.rAGGraphEdge.update = ((args: unknown) => {
      edgeUpdateCalls.push(args);
      return Promise.resolve({ id: (args as { where: { id: string } }).where.id }) as never;
    }) as typeof prismaClient.rAGGraphEdge.update;

    prismaClient.rAGClaim.update = ((args: unknown) => {
      claimUpdateCalls.push(args);
      return Promise.resolve({ id: (args as { where: { id: string } }).where.id }) as never;
    }) as typeof prismaClient.rAGClaim.update;

    prismaClient.$executeRaw = ((args: unknown) => {
      executeRawCalls.push(args);
      return Promise.resolve(1);
    }) as never;

    try {
      await persistCommunitySummaries(result, 'ns-a');

      expect(summaryCreateCalls).toHaveLength(2);
      expect(summaryCreateCalls[0]).toMatchObject({
        data: { namespace: 'ns-a', communityName: 'n', summaryContent: 's' },
      });
      expect(edgeFindManyCalls[0]).toMatchObject({ where: { namespace: 'ns-a' } });
      expect(claimFindManyCalls[0]).toMatchObject({ where: { namespace: 'ns-a' } });
      expect(entityFindManyCalls[0]).toMatchObject({ where: { namespace: 'ns-a' } });
      expect(profileFindManyCalls[0]).toMatchObject({ where: { namespace: 'ns-a' } });
      expect(summaryFindManyCalls[0]).toMatchObject({ where: { namespace: 'ns-a' } });
      expect(executeRawCalls).toHaveLength(2);
      expect((executeRawCalls[0] as { text?: string }).text).toContain('"namespace"');
      expect(edgeUpdateCalls.length).toBeGreaterThan(0);
      expect(claimUpdateCalls).toEqual([
        { where: { id: 'claim-a' }, data: { communitySummaryId: 'summary-1' } },
      ]);
    } finally {
      modelLoaderSingleton.models = originalModels;
      prismaClient.rAGCommunitySummary.findMany = originalSummaryFindMany;
      prismaClient.rAGCommunitySummary.create = originalSummaryCreate;
      prismaClient.rAGGraphEdge.findMany = originalEdgeFindMany;
      prismaClient.rAGClaim.findMany = originalClaimFindMany;
      prismaClient.rAGEntity.findMany = originalEntityFindMany;
      if (originalProfileFindMany) {
        entityProfileClient.entityProfile = { findMany: originalProfileFindMany };
      } else {
        delete entityProfileClient.entityProfile;
      }
      prismaClient.rAGGraphEdge.update = originalEdgeUpdate;
      prismaClient.rAGClaim.update = originalClaimUpdate;
      prismaClient.$executeRaw = originalExecuteRaw;
    }
  });

  it('ignores detached edges and claims that are not attached to a parent document', async () => {
    const prompts: string[] = [];

    modelLoaderSingleton.models = {
      embedding: { embedQuery: async () => [0.1, 0.2] },
      slice: {
        invoke: async (prompt: string) => {
          prompts.push(prompt);
          return JSON.stringify({ communityName: 'n', summaryContent: 's' });
        },
      },
    } as any;

    prismaClient.rAGGraphEdge.findMany = (() => Promise.resolve([
      {
        id: 'edge-valid',
        sourceEntity: { name: 'A' },
        targetEntity: { name: 'B' },
        relationshipDesc: 'friends',
        weight: 2,
      },
      {
        id: 'edge-detached',
        sourceEntity: { name: 'X' },
        targetEntity: { name: 'Y' },
        relationshipDesc: 'orphan',
        weight: 1,
        parentId: null,
      },
    ]) as never) as typeof prismaClient.rAGGraphEdge.findMany;

    prismaClient.rAGClaim.findMany = (() => Promise.resolve([
      {
        id: 'claim-valid',
        subjectEntity: { name: 'A' },
        objectEntity: { name: 'B' },
        description: 'A and B are buddies',
      },
      {
        id: 'claim-detached',
        subjectEntity: { name: 'Z' },
        objectEntity: null,
        description: 'floating claim',
        sourceParentId: null,
      },
    ]) as never) as typeof prismaClient.rAGClaim.findMany;

    prismaClient.rAGEntity.findMany = (() =>
      Promise.resolve([
        { id: 'e1', name: 'A', description: 'desc A' },
        { id: 'e2', name: 'B', description: 'desc B' },
      ]) as never) as typeof prismaClient.rAGEntity.findMany;
    entityProfileClient.entityProfile = {
      findMany: (() => Promise.resolve([]) as never) as () => Promise<never>,
    };

    prismaClient.rAGCommunitySummary.create = (() =>
      Promise.resolve({ id: 'summary-1' }) as never) as typeof prismaClient.rAGCommunitySummary.create;
    prismaClient.rAGCommunitySummary.findMany = (() =>
      Promise.resolve([]) as never) as typeof prismaClient.rAGCommunitySummary.findMany;
    prismaClient.rAGCommunitySummary.deleteMany = (() =>
      Promise.resolve({ count: 0 }) as never) as typeof prismaClient.rAGCommunitySummary.deleteMany;
    prismaClient.rAGGraphEdge.update = (() => Promise.resolve({ id: 'e' }) as never) as typeof prismaClient.rAGGraphEdge.update;
    prismaClient.rAGClaim.update = (() => Promise.resolve({ id: 'c' }) as never) as typeof prismaClient.rAGClaim.update;
    prismaClient.$executeRaw = (() => Promise.resolve(1) as never) as never;

    try {
      await persistCommunitySummaries(
        { algorithm: 'leiden', membership: [0, 0], communities: [{ id: 0, members: ['A', 'B'] }] },
        'ns-a',
      );

      const prompt = prompts[0]!;
      expect(prompt).toContain('A');
      expect(prompt).toContain('B');
      expect(prompt).not.toContain('orphan');
      expect(prompt).not.toContain('floating claim');
    } finally {
      modelLoaderSingleton.models = originalModels;
      prismaClient.rAGCommunitySummary.create = originalSummaryCreate;
      prismaClient.rAGCommunitySummary.findMany = originalSummaryFindMany;
      prismaClient.rAGCommunitySummary.deleteMany = originalSummaryDeleteMany;
      prismaClient.rAGGraphEdge.findMany = originalEdgeFindMany;
      prismaClient.rAGClaim.findMany = originalClaimFindMany;
      prismaClient.rAGEntity.findMany = originalEntityFindMany;
      if (originalProfileFindMany) {
        entityProfileClient.entityProfile = { findMany: originalProfileFindMany };
      } else {
        delete entityProfileClient.entityProfile;
      }
      prismaClient.rAGGraphEdge.update = originalEdgeUpdate;
      prismaClient.rAGClaim.update = originalClaimUpdate;
      prismaClient.$executeRaw = originalExecuteRaw;
    }
  });

  it('prefers EntityProfile over the extracted description for node summaries', async () => {
    const prompts: string[] = [];

    modelLoaderSingleton.models = {
      embedding: { embedQuery: async () => [0.1, 0.2] },
      slice: {
        invoke: async (prompt: string) => {
          prompts.push(prompt);
          return JSON.stringify({ communityName: 'n', summaryContent: 's' });
        },
      },
    } as any;

    prismaClient.rAGGraphEdge.findMany = (() => Promise.resolve([]) as never) as typeof prismaClient.rAGGraphEdge.findMany;
    prismaClient.rAGClaim.findMany = (() => Promise.resolve([]) as never) as typeof prismaClient.rAGClaim.findMany;
    prismaClient.rAGEntity.findMany = (() =>
      Promise.resolve([
        { id: 'e1', name: 'A', description: 'desc-A' },
        { id: 'e2', name: 'B', description: 'desc-B' },
      ]) as never) as typeof prismaClient.rAGEntity.findMany;
    entityProfileClient.entityProfile = {
      findMany: (() =>
        Promise.resolve([{ entityId: 'e1', profile: 'PROFILE-A' }]) as never) as () => Promise<never>,
    };

    prismaClient.rAGCommunitySummary.create = (() =>
      Promise.resolve({ id: 'summary-1' }) as never) as typeof prismaClient.rAGCommunitySummary.create;
    prismaClient.rAGCommunitySummary.findMany = (() =>
      Promise.resolve([]) as never) as typeof prismaClient.rAGCommunitySummary.findMany;
    prismaClient.rAGCommunitySummary.deleteMany = (() =>
      Promise.resolve({ count: 0 }) as never) as typeof prismaClient.rAGCommunitySummary.deleteMany;
    prismaClient.rAGGraphEdge.update = (() => Promise.resolve({ id: 'e' }) as never) as typeof prismaClient.rAGGraphEdge.update;
    prismaClient.rAGClaim.update = (() => Promise.resolve({ id: 'c' }) as never) as typeof prismaClient.rAGClaim.update;
    prismaClient.$executeRaw = (() => Promise.resolve(1) as never) as never;

    try {
      await persistCommunitySummaries(
        { algorithm: 'leiden', membership: [0, 0], communities: [{ id: 0, members: ['A', 'B'] }] },
        'ns-a',
      );

      const prompt = prompts[0]!;
      expect(prompt).toContain('- A: PROFILE-A');
      expect(prompt).toContain('- B: desc-B');
      expect(prompt).not.toContain('desc-A');
    } finally {
      modelLoaderSingleton.models = originalModels;
      prismaClient.rAGCommunitySummary.create = originalSummaryCreate;
      prismaClient.rAGCommunitySummary.findMany = originalSummaryFindMany;
      prismaClient.rAGCommunitySummary.deleteMany = originalSummaryDeleteMany;
      prismaClient.rAGGraphEdge.findMany = originalEdgeFindMany;
      prismaClient.rAGClaim.findMany = originalClaimFindMany;
      prismaClient.rAGEntity.findMany = originalEntityFindMany;
      if (originalProfileFindMany) {
        entityProfileClient.entityProfile = { findMany: originalProfileFindMany };
      } else {
        delete entityProfileClient.entityProfile;
      }
      prismaClient.rAGGraphEdge.update = originalEdgeUpdate;
      prismaClient.rAGClaim.update = originalClaimUpdate;
      prismaClient.$executeRaw = originalExecuteRaw;
    }
  });

  it('reuses unchanged existing community summary and prunes stale summaries', async () => {
    let summaryCreateCount = 0;
    let deleteWhere: unknown;

    modelLoaderSingleton.models = {
      embedding: { embedQuery: async () => [0.1, 0.2] },
      slice: {
        invoke: async () => {
          summaryCreateCount += 1;
          return JSON.stringify({ communityName: 'new-comm', summaryContent: 'new-summary' });
        },
      },
    } as any;

    prismaClient.rAGGraphEdge.findMany = (() =>
      Promise.resolve([
        {
          id: 'edge-ab',
          communitySummaryId: 'existing-sum-1',
          sourceEntity: { name: 'A' },
          targetEntity: { name: 'B' },
          relationshipDesc: 'friends',
          weight: 2,
        },
      ]) as never) as typeof prismaClient.rAGGraphEdge.findMany;

    prismaClient.rAGClaim.findMany = (() =>
      Promise.resolve([
        {
          id: 'claim-ab',
          communitySummaryId: 'existing-sum-1',
          subjectEntity: { name: 'A' },
          objectEntity: { name: 'B' },
          description: 'A and B are buddies',
        },
      ]) as never) as typeof prismaClient.rAGClaim.findMany;

    prismaClient.rAGEntity.findMany = (() =>
      Promise.resolve([
        { id: 'e1', name: 'A', description: 'desc A' },
        { id: 'e2', name: 'B', description: 'desc B' },
      ]) as never) as typeof prismaClient.rAGEntity.findMany;

    prismaClient.rAGCommunitySummary.findMany = (() =>
      Promise.resolve([
        { id: 'existing-sum-1', communityName: 'Community AB' },
        { id: 'stale-sum-99', communityName: 'Obsolete Community' },
      ]) as never) as typeof prismaClient.rAGCommunitySummary.findMany;

    prismaClient.rAGCommunitySummary.deleteMany = (((args: { where: object }) => {
      deleteWhere = args.where;
      return Promise.resolve({ count: 1 });
    }) as unknown) as typeof prismaClient.rAGCommunitySummary.deleteMany;

    prismaClient.rAGCommunitySummary.create = (() => {
      summaryCreateCount += 1;
      return Promise.resolve({ id: 'new-id', communityName: 'new' });
    }) as never;
    prismaClient.rAGGraphEdge.update = (() => Promise.resolve({ id: 'e' })) as never;
    prismaClient.rAGClaim.update = (() => Promise.resolve({ id: 'c' })) as never;

    try {
      const persistStats = await persistCommunitySummaries(
        {
          algorithm: 'leiden',
          membership: [0, 0],
          communities: [{ id: 0, members: ['A', 'B'] }],
        },
        'ns-a',
      );

      // Reused existing-sum-1, so 0 calls to LLM / summary create!
      expect(summaryCreateCount).toBe(0);
      expect(persistStats).toEqual({ total: 1, reused: 1, updated: 0 });
      // Stale summary stale-sum-99 should be deleted
      expect(deleteWhere).toEqual({ id: { in: ['stale-sum-99'] }, namespace: 'ns-a' });
    } finally {
      modelLoaderSingleton.models = originalModels;
      prismaClient.rAGCommunitySummary.findMany = originalSummaryFindMany;
      prismaClient.rAGCommunitySummary.deleteMany = originalSummaryDeleteMany;
      prismaClient.rAGCommunitySummary.create = originalSummaryCreate;
      prismaClient.rAGGraphEdge.findMany = originalEdgeFindMany;
      prismaClient.rAGClaim.findMany = originalClaimFindMany;
      prismaClient.rAGEntity.findMany = originalEntityFindMany;
      prismaClient.rAGGraphEdge.update = originalEdgeUpdate;
      prismaClient.rAGClaim.update = originalClaimUpdate;
      prismaClient.$executeRaw = originalExecuteRaw;
    }
  });
});
