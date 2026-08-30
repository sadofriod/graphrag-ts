import { describe, expect, it } from 'bun:test';

import { prismaClient } from '../../helper/prismaClient';
import { modelLoaderSingleton } from '../../modelLoader';
import { persistCommunitySummaries } from './persistCommunitySummaries';
import type { CommunityDetectionResult } from '../types';

describe('persistCommunitySummaries', () => {
  const originalModels = modelLoaderSingleton.models;
  const originalSummaryCreate = prismaClient.rAGCommunitySummary.create;
  const originalEdgeFindMany = prismaClient.rAGGraphEdge.findMany;
  const originalClaimFindMany = prismaClient.rAGClaim.findMany;
  const originalEntityFindMany = prismaClient.rAGEntity.findMany;
  const originalProfileFindMany = prismaClient.entityProfile.findMany;
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

    modelLoaderSingleton.models = {
      embedding: { embedQuery: async () => [0.1, 0.2] },
      slice: {
        invoke: async () => JSON.stringify({ communityName: 'n', summaryContent: 's' }),
      },
    } as any;

    prismaClient.rAGGraphEdge.findMany = (() =>
      Promise.resolve([
        { id: 'edge-ab', sourceEntity: { name: 'A' }, targetEntity: { name: 'B' }, weight: 2 },
        { id: 'edge-ac', sourceEntity: { name: 'A' }, targetEntity: { name: 'C' }, weight: 1 },
      ]) as never) as typeof prismaClient.rAGGraphEdge.findMany;

    prismaClient.rAGClaim.findMany = (() =>
      Promise.resolve([
        { id: 'claim-a', subjectEntity: { name: 'A' }, objectEntity: null, description: 'd' },
      ]) as never) as typeof prismaClient.rAGClaim.findMany;

    prismaClient.rAGEntity.findMany = (() =>
      Promise.resolve([]) as never) as typeof prismaClient.rAGEntity.findMany;

    prismaClient.entityProfile.findMany = (() =>
      Promise.resolve([]) as never) as typeof prismaClient.entityProfile.findMany;

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
      expect(executeRawCalls).toHaveLength(2);
      expect((executeRawCalls[0] as { text?: string }).text).toContain('"namespace"');
      expect(edgeUpdateCalls.length).toBeGreaterThan(0);
      expect(claimUpdateCalls).toEqual([
        { where: { id: 'claim-a' }, data: { communitySummaryId: 'summary-1' } },
      ]);
    } finally {
      modelLoaderSingleton.models = originalModels;
      prismaClient.rAGCommunitySummary.create = originalSummaryCreate;
      prismaClient.rAGGraphEdge.findMany = originalEdgeFindMany;
      prismaClient.rAGClaim.findMany = originalClaimFindMany;
      prismaClient.rAGEntity.findMany = originalEntityFindMany;
      prismaClient.entityProfile.findMany = originalProfileFindMany;
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
    prismaClient.entityProfile.findMany = (() =>
      Promise.resolve([{ entityId: 'e1', profile: 'PROFILE-A' }]) as never) as typeof prismaClient.entityProfile.findMany;

    prismaClient.rAGCommunitySummary.create = (() =>
      Promise.resolve({ id: 'summary-1' }) as never) as typeof prismaClient.rAGCommunitySummary.create;
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
      prismaClient.rAGGraphEdge.findMany = originalEdgeFindMany;
      prismaClient.rAGClaim.findMany = originalClaimFindMany;
      prismaClient.rAGEntity.findMany = originalEntityFindMany;
      prismaClient.entityProfile.findMany = originalProfileFindMany;
      prismaClient.rAGGraphEdge.update = originalEdgeUpdate;
      prismaClient.rAGClaim.update = originalClaimUpdate;
      prismaClient.$executeRaw = originalExecuteRaw;
    }
  });
});
