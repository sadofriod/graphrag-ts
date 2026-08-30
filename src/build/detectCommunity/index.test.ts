import { describe, expect, it } from 'bun:test';

import { modelLoaderSingleton } from '../modelLoader';
import { prismaClient } from '../../build/helper/prismaClient';
import { detectCommunity, loadCommunityGraph } from './index';

const trianglePlusPair = [
  { source: 'A', target: 'B', weight: 2 },
  { source: 'B', target: 'C', weight: 2 },
  { source: 'C', target: 'A', weight: 2 },
  { source: 'D', target: 'E', weight: 1 },
];

describe('detectCommunity', () => {
  it('groups a triangle and an isolated pair into two communities with weighted leiden', async () => {
    const result = await detectCommunity({ edges: trianglePlusPair, namespace: 'ns-a' });

    expect(result.algorithm).toBe('leiden');
    expect(result.membership).toEqual([0, 0, 0, 1, 1]);
    expect(result.communities).toEqual([
      { id: 0, members: ['A', 'B', 'C'] },
      { id: 1, members: ['D', 'E'] },
    ]);
    expect(result.score).toBeTypeOf('number');
  });

  it('treats higher weight as repeated edges without changing the partition outcome', async () => {
    const result = await detectCommunity({
      edges: [
        { source: 'A', target: 'B', weight: 3 },
        { source: 'B', target: 'C', weight: 3 },
        { source: 'C', target: 'A', weight: 3 },
        { source: 'D', target: 'E', weight: 1 },
      ],
      namespace: 'ns-a',
    });

    expect(result.membership).toEqual([0, 0, 0, 1, 1]);
    expect(result.communities).toHaveLength(2);
    expect(result.score).toBeTypeOf('number');
  });

  it('puts a complete graph into a single community', async () => {
    const result = await detectCommunity({
      edges: [
        { source: 'A', target: 'B', weight: 3 },
        { source: 'A', target: 'C', weight: 3 },
        { source: 'A', target: 'D', weight: 3 },
        { source: 'B', target: 'C', weight: 3 },
        { source: 'B', target: 'D', weight: 3 },
        { source: 'C', target: 'D', weight: 3 },
      ],
      namespace: 'ns-a',
    });

    expect(result.membership).toEqual([0, 0, 0, 0]);
    expect(result.communities).toEqual([{ id: 0, members: ['A', 'B', 'C', 'D'] }]);
  });

  it('persists each detected community as a summary and links the matching edges', async () => {
    const originalModels = modelLoaderSingleton.models;
    const originalSummaryCreate = prismaClient.rAGCommunitySummary.create;
    const originalFindMany = prismaClient.rAGGraphEdge.findMany;
    const originalEdgeUpdate = prismaClient.rAGGraphEdge.update;
    const originalExecuteRaw = prismaClient.$executeRaw;

    const summaryCreateCalls: unknown[] = [];
    const edgeUpdateCalls: unknown[] = [];
    const executeRawCalls: unknown[] = [];

    modelLoaderSingleton.models = {
      embedding: {
        embedQuery: async () => [0.1, 0.2],
      },
      slice: {
        invoke: async () => JSON.stringify({
          communityName: '政策协同与执行机制',
          summaryContent: '该社区围绕政策制定与协同执行展开，成员间形成清晰的协作闭环。',
        }),
      },
    } as any;

    prismaClient.rAGCommunitySummary.create = ((args: unknown) => {
      summaryCreateCalls.push(args);
      const data = (args as { data?: Record<string, unknown> }).data ?? {};
      return Promise.resolve({
        id: `summary-${summaryCreateCalls.length}`,
        ...data,
      }) as never;
    }) as typeof prismaClient.rAGCommunitySummary.create;

    prismaClient.rAGGraphEdge.findMany = (() =>
      Promise.resolve([
        { id: 'edge-ab', sourceEntity: { name: 'A' }, targetEntity: { name: 'B' }, weight: 2 },
        { id: 'edge-bc', sourceEntity: { name: 'B' }, targetEntity: { name: 'C' }, weight: 2 },
        { id: 'edge-de', sourceEntity: { name: 'D' }, targetEntity: { name: 'E' }, weight: 1 },
      ]) as never) as typeof prismaClient.rAGGraphEdge.findMany;

    prismaClient.rAGGraphEdge.update = ((args: unknown) => {
      edgeUpdateCalls.push(args);
      return Promise.resolve({ id: (args as { where: { id: string } }).where.id }) as never;
    }) as typeof prismaClient.rAGGraphEdge.update;

    prismaClient.$executeRaw = ((args: unknown) => {
      executeRawCalls.push(args);
      return Promise.resolve(1);
    }) as never;

    const originalClaimFindMany = prismaClient.rAGClaim.findMany;
    const originalEntityFindMany = prismaClient.rAGEntity.findMany;
    const originalClaimUpdate = prismaClient.rAGClaim.update;
    const claimUpdateCalls: unknown[] = [];

    prismaClient.rAGClaim.findMany = (() =>
      Promise.resolve([
        { id: 'claim-1', subjectEntity: { name: 'A' }, objectEntity: null, description: 'A 是主角' },
      ]) as never) as typeof prismaClient.rAGClaim.findMany;
    prismaClient.rAGEntity.findMany = (() =>
      Promise.resolve([]) as never) as typeof prismaClient.rAGEntity.findMany;
    prismaClient.rAGClaim.update = ((args: unknown) => {
      claimUpdateCalls.push(args);
      return Promise.resolve({ id: (args as { where: { id: string } }).where.id }) as never;
    }) as typeof prismaClient.rAGClaim.update;

    try {
      const result = await detectCommunity({
        edges: [
          { source: 'A', target: 'B', weight: 2 },
          { source: 'B', target: 'C', weight: 2 },
          { source: 'C', target: 'A', weight: 2 },
          { source: 'D', target: 'E', weight: 1 },
        ],
        persistCommunitySummaries: true,        namespace: 'ns-a',      });

      expect(result.communities.map(({ members }) => members)).toEqual([
        ['A', 'B', 'C'],
        ['D', 'E'],
      ]);
      expect(summaryCreateCalls).toHaveLength(2);
      expect(executeRawCalls).toHaveLength(2);
      expect((executeRawCalls[0] as { values?: unknown[] }).values).toContain('[0.1,0.2]');
      expect((executeRawCalls[0] as { text?: string }).text).toContain('"namespace"');
      expect(edgeUpdateCalls.length).toBeGreaterThan(0);
      expect(claimUpdateCalls).toEqual([
        { where: { id: 'claim-1' }, data: { communitySummaryId: 'summary-1' } },
      ]);
    } finally {
      modelLoaderSingleton.models = originalModels;
      prismaClient.rAGCommunitySummary.create = originalSummaryCreate;
      prismaClient.rAGGraphEdge.findMany = originalFindMany;
      prismaClient.rAGGraphEdge.update = originalEdgeUpdate;
      prismaClient.$executeRaw = originalExecuteRaw;
      prismaClient.rAGClaim.findMany = originalClaimFindMany;
      prismaClient.rAGEntity.findMany = originalEntityFindMany;
      prismaClient.rAGClaim.update = originalClaimUpdate;
    }
  });

  it('uses the community summary prompt and slice model result for communityName and summaryContent', async () => {
    const originalModels = modelLoaderSingleton.models;
    const originalSummaryCreate = prismaClient.rAGCommunitySummary.create;
    const originalFindMany = prismaClient.rAGGraphEdge.findMany;
    const originalEdgeUpdate = prismaClient.rAGGraphEdge.update;
    const originalExecuteRaw = prismaClient.$executeRaw;

    const prompts: string[] = [];
    const summaryCreateCalls: unknown[] = [];
    const edgeUpdateCalls: unknown[] = [];

    modelLoaderSingleton.models = {
      embedding: {
        embedQuery: async () => [0.1, 0.2],
      },
      slice: {
        invoke: async (prompt: string) => {
          prompts.push(prompt);
          return JSON.stringify({
            communityName: '政策协同与执行机制',
            summaryContent: '该社区围绕政策制定与协同执行展开，成员间形成清晰的协作闭环。',
          });
        },
      } as unknown as typeof modelLoaderSingleton.models extends null ? never : NonNullable<typeof modelLoaderSingleton.models>['slice'],
    } as unknown as typeof modelLoaderSingleton.models;

    prismaClient.rAGCommunitySummary.create = ((args: unknown) => {
      summaryCreateCalls.push(args);
      const data = (args as { data?: Record<string, unknown> }).data ?? {};
      return Promise.resolve({
        id: `summary-${summaryCreateCalls.length}`,
        ...data,
      }) as never;
    }) as typeof prismaClient.rAGCommunitySummary.create;

    prismaClient.rAGGraphEdge.findMany = (() =>
      Promise.resolve([
        { id: 'edge-ab', sourceEntity: { name: 'A' }, targetEntity: { name: 'B' }, weight: 2 },
        { id: 'edge-bc', sourceEntity: { name: 'B' }, targetEntity: { name: 'C' }, weight: 2 },
        { id: 'edge-de', sourceEntity: { name: 'D' }, targetEntity: { name: 'E' }, weight: 1 },
      ]) as never) as typeof prismaClient.rAGGraphEdge.findMany;

    prismaClient.rAGGraphEdge.update = ((args: unknown) => {
      edgeUpdateCalls.push(args);
      return Promise.resolve({ id: (args as { where: { id: string } }).where.id }) as never;
    }) as typeof prismaClient.rAGGraphEdge.update;

    prismaClient.$executeRaw = (() => Promise.resolve(1)) as never;

    const originalClaimFindMany = prismaClient.rAGClaim.findMany;
    const originalEntityFindMany = prismaClient.rAGEntity.findMany;
    const originalClaimUpdate = prismaClient.rAGClaim.update;

    prismaClient.rAGClaim.findMany = (() =>
      Promise.resolve([]) as never) as typeof prismaClient.rAGClaim.findMany;
    prismaClient.rAGEntity.findMany = (() =>
      Promise.resolve([
        { name: 'A', description: '主角' },
        { name: 'B', description: '配角' },
        { name: 'C', description: '配角' },
      ]) as never) as typeof prismaClient.rAGEntity.findMany;
    prismaClient.rAGClaim.update = ((args: unknown) =>
      Promise.resolve({ id: (args as { where: { id: string } }).where.id }) as never) as typeof prismaClient.rAGClaim.update;

    try {
      await detectCommunity({
        edges: [
          { source: 'A', target: 'B', weight: 2 },
          { source: 'B', target: 'C', weight: 2 },
          { source: 'C', target: 'A', weight: 2 },
          { source: 'D', target: 'E', weight: 1 },
        ],
        persistCommunitySummaries: true,
        namespace: 'ns-a',
      });

      expect(prompts).toHaveLength(2);
      expect(prompts[0]).toContain('communityId');
      expect(prompts[0]).toContain('communityName');
      expect(prompts[0]).toContain('【成员】A、B、C');
      expect(prompts[0]).toContain('【节点摘要】');
      expect(prompts[0]).toContain('- A: 主角');
      expect(prompts[0]).toContain('【关键关系】');
      expect(prompts[0]).toContain('--');
      expect(summaryCreateCalls[0]).toMatchObject({
        data: {
          communityName: '政策协同与执行机制',
          summaryContent: '该社区围绕政策制定与协同执行展开，成员间形成清晰的协作闭环。',
        },
      });
      expect(edgeUpdateCalls.length).toBeGreaterThan(0);
    } finally {
      modelLoaderSingleton.models = originalModels;
      prismaClient.rAGCommunitySummary.create = originalSummaryCreate;
      prismaClient.rAGGraphEdge.findMany = originalFindMany;
      prismaClient.rAGGraphEdge.update = originalEdgeUpdate;
      prismaClient.$executeRaw = originalExecuteRaw;
      prismaClient.rAGClaim.findMany = originalClaimFindMany;
      prismaClient.rAGEntity.findMany = originalEntityFindMany;
      prismaClient.rAGClaim.update = originalClaimUpdate;
    }
  });

  it('returns an empty result when there are no edges', async () => {
    const result = await detectCommunity({ edges: [], namespace: 'ns-a' });

    expect(result.communities).toEqual([]);
    expect(result.membership).toEqual([]);
    expect(result.score).toBeUndefined();
  });
});

describe('loadCommunityGraph', () => {
  it('maps graph edges from the database into community edges', async () => {
    const originalFindMany = prismaClient.rAGGraphEdge.findMany;

    prismaClient.rAGGraphEdge.findMany = (() =>
      Promise.resolve([
        { sourceEntity: { name: 'Alpha' }, targetEntity: { name: 'Beta' }, weight: 4 },
        { sourceEntity: { name: 'Beta' }, targetEntity: { name: 'Gamma' }, weight: 2 },
      ]) as never) as typeof prismaClient.rAGGraphEdge.findMany;

    try {
      const result = await loadCommunityGraph();
      expect(result.edges).toEqual([
        { source: 'Alpha', target: 'Beta', weight: 4 },
        { source: 'Beta', target: 'Gamma', weight: 2 },
      ]);
    } finally {
      prismaClient.rAGGraphEdge.findMany = originalFindMany;
    }
  });
});
