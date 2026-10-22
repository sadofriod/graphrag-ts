import { describe, expect, it } from 'bun:test';

import { prismaClient } from '../../helper/prismaClient';
import { modelLoaderSingleton } from '../../modelLoader';
import { computeCommunityFingerprint } from './communityFingerprint';
import { persistCommunitySummaries } from './persistCommunitySummaries';

describe('community summary fingerprint regression', () => {
  it('regenerates a summary when claim content changes despite stable assignments', async () => {
    const originalModels = modelLoaderSingleton.models;
    const originalMethods = {
      edgeFindMany: prismaClient.rAGGraphEdge.findMany,
      claimFindMany: prismaClient.rAGClaim.findMany,
      entityFindMany: prismaClient.rAGEntity.findMany,
      summaryFindMany: prismaClient.rAGCommunitySummary.findMany,
      summaryDeleteMany: prismaClient.rAGCommunitySummary.deleteMany,
      summaryCreate: prismaClient.rAGCommunitySummary.create,
      summaryUpdate: prismaClient.rAGCommunitySummary.update,
      edgeUpdate: prismaClient.rAGGraphEdge.update,
      claimUpdate: prismaClient.rAGClaim.update,
      executeRaw: prismaClient.$executeRaw,
    };
    const entityProfileClient = prismaClient as unknown as { entityProfile?: { findMany: (...args: unknown[]) => unknown } };
    const originalProfileFindMany = entityProfileClient.entityProfile?.findMany;
    const oldFingerprint = computeCommunityFingerprint({
      members: ['A', 'B'],
      entities: [{ name: 'A', description: 'Company A' }, { name: 'B', description: 'Company B' }],
      edges: [{ source: 'A', target: 'B', relationshipDesc: 'agreement' }],
      claims: [{ subject: 'A', object: 'B', description: 'The agreement date is 2024-02-01' }],
    });
    let summaryCreateCount = 0;
    let summaryUpdateData: Record<string, unknown> | undefined;
    let summaryUpdateWhere: unknown;
    let summaryDeleteArgs: unknown;
    let summaryPrompt = '';

    modelLoaderSingleton.models = {
      embedding: { embedQuery: async () => [0.1, 0.2] },
      slice: {
        invoke: async (prompt: string) => {
          summaryPrompt = prompt;
          return JSON.stringify({ communityName: 'Agreement Timeline', summaryContent: 'The agreement date is 2025-02-01.' });
        },
      },
    } as any;
    prismaClient.rAGGraphEdge.findMany = (() => Promise.resolve([{ id: 'edge-ab', communitySummaryId: 'existing-sum-1', sourceEntity: { name: 'A' }, targetEntity: { name: 'B' }, relationshipDesc: 'agreement', weight: 1 }]) as never) as typeof prismaClient.rAGGraphEdge.findMany;
    prismaClient.rAGClaim.findMany = (() => Promise.resolve([{ id: 'claim-updated-date', communitySummaryId: 'existing-sum-1', subjectEntity: { name: 'A' }, objectEntity: { name: 'B' }, description: 'The agreement date is 2025-02-01', sourceParentId: 'parent-new' }]) as never) as typeof prismaClient.rAGClaim.findMany;
    prismaClient.rAGEntity.findMany = (() => Promise.resolve([{ id: 'e1', name: 'A', description: 'Company A' }, { id: 'e2', name: 'B', description: 'Company B' }]) as never) as typeof prismaClient.rAGEntity.findMany;
    entityProfileClient.entityProfile = { findMany: (() => Promise.resolve([]) as never) as () => Promise<never> };
    prismaClient.rAGCommunitySummary.findMany = (() => Promise.resolve([{
      id: 'existing-sum-1',
      communityName: 'Agreement Timeline (old)',
      contentFingerprint: oldFingerprint,
      members: ['A', 'B'],
      level: 0,
    }]) as never) as typeof prismaClient.rAGCommunitySummary.findMany;
    prismaClient.rAGCommunitySummary.deleteMany = ((args: unknown) => {
      summaryDeleteArgs = args;
      return Promise.resolve({ count: 1 });
    }) as never;
    prismaClient.rAGCommunitySummary.create = ((args: unknown) => {
      summaryCreateCount += 1;
      return Promise.resolve({ id: 'new-sum-1', ...((args as { data?: Record<string, unknown> }).data ?? {}) }) as never;
    }) as typeof prismaClient.rAGCommunitySummary.create;
    prismaClient.rAGCommunitySummary.update = ((args: unknown) => {
      const updateArgs = args as { where: unknown; data?: Record<string, unknown> };
      summaryUpdateWhere = updateArgs.where;
      summaryUpdateData = updateArgs.data;
      return Promise.resolve({ id: 'existing-sum-1', ...updateArgs.data }) as never;
    }) as typeof prismaClient.rAGCommunitySummary.update;
    prismaClient.rAGGraphEdge.update = (() => Promise.resolve({ id: 'edge-ab' })) as never;
    prismaClient.rAGClaim.update = (() => Promise.resolve({ id: 'claim-updated-date' })) as never;
    prismaClient.$executeRaw = (() => Promise.resolve(1)) as never;

    try {
      const persistStats = await persistCommunitySummaries(
        { algorithm: 'leiden', membership: [0, 0], communities: [{ id: 0, members: ['A', 'B'] }] },
        'ns-a',
      );
      expect(summaryCreateCount).toBe(0);
      expect(summaryPrompt).toContain('The agreement date is 2025-02-01');
      expect(summaryUpdateWhere).toEqual({ id: 'existing-sum-1' });
      expect(summaryUpdateData).toMatchObject({
        summaryContent: 'The agreement date is 2025-02-01.',
        members: ['A', 'B'],
        level: 0,
      });
      expect(summaryUpdateData?.contentFingerprint).not.toBe(oldFingerprint);
      expect(summaryDeleteArgs).toBeUndefined();
      expect(persistStats).toEqual({ total: 1, reused: 0, updated: 1 });
    } finally {
      modelLoaderSingleton.models = originalModels;
      prismaClient.rAGGraphEdge.findMany = originalMethods.edgeFindMany;
      prismaClient.rAGClaim.findMany = originalMethods.claimFindMany;
      prismaClient.rAGEntity.findMany = originalMethods.entityFindMany;
      prismaClient.rAGCommunitySummary.findMany = originalMethods.summaryFindMany;
      prismaClient.rAGCommunitySummary.deleteMany = originalMethods.summaryDeleteMany;
      prismaClient.rAGCommunitySummary.create = originalMethods.summaryCreate;
      prismaClient.rAGCommunitySummary.update = originalMethods.summaryUpdate;
      prismaClient.rAGGraphEdge.update = originalMethods.edgeUpdate;
      prismaClient.rAGClaim.update = originalMethods.claimUpdate;
      prismaClient.$executeRaw = originalMethods.executeRaw;
      if (originalProfileFindMany) entityProfileClient.entityProfile = { findMany: originalProfileFindMany };
      else delete entityProfileClient.entityProfile;
    }
  });
});