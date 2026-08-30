import { describe, expect, it } from 'bun:test';

import { prismaClient } from '../../build/helper/prismaClient';
import { modelLoaderSingleton } from '../../build/modelLoader';
import { GraphRAGRetrievalService } from './GraphRAGRetrievalService';

describe('GraphRAGRetrievalService', () => {
  const originalModels = modelLoaderSingleton.models;
  const originalFindManyEntity = prismaClient.rAGEntity.findMany;
  const originalFindManyEdge = prismaClient.rAGGraphEdge.findMany;
  const originalFindManySummary = prismaClient.rAGCommunitySummary.findMany;
  const originalFindManyClaim = prismaClient.rAGClaim.findMany;
  const originalQueryRaw = prismaClient.$queryRaw;

  const entities = [
    { id: 'eA', name: 'A' },
    { id: 'eB', name: 'B' },
  ];
  const edgeRows = [
    {
      id: 'edge-1',
      parentId: 'p1',
      sourceEntityId: 'eA',
      targetEntityId: 'eB',
      sourceEntity: { name: 'A' },
      targetEntity: { name: 'B' },
      relationshipDesc: '合作',
      weight: 2,
      communitySummaryId: 'c1',
    },
  ];
  const summaries = [
    { id: 'c1', communityName: '社区A', summaryContent: 'A 与 B 的合作摘要' },
  ];
  const claimRows = [
    {
      id: 'claim-1',
      subjectEntity: { name: 'A' },
      objectEntity: { name: 'B' },
      description: 'A 与 B 是多年合作伙伴',
      sourceParentId: 'p1',
      sourceChunkId: 'child-1',
    },
  ];

  const installMocks = (sliceResponses: string[]) => {
    prismaClient.rAGEntity.findMany = (() => Promise.resolve(entities)) as never;
    prismaClient.rAGGraphEdge.findMany = (() => Promise.resolve(edgeRows)) as never;
    prismaClient.rAGCommunitySummary.findMany = ((args: unknown) => {
      const ids = (args as { where?: { id?: { in?: string[] } } })?.where?.id?.in;
      return Promise.resolve(ids ? summaries.filter((summary) => ids.includes(summary.id)) : summaries);
    }) as never;
    prismaClient.rAGClaim.findMany = (() => Promise.resolve(claimRows)) as never;
    prismaClient.$queryRaw = ((query: unknown) => {
      const text = JSON.stringify(query);
      if (text.includes('WITH RECURSIVE')) {
        return Promise.resolve([{ community_id: 'c1', entity_id: 'eA' }]);
      }
      if (text.includes('summary_embedding')) {
        return Promise.resolve([{ id: 'c1', similarity: 0.9 }]);
      }
      if (text.includes('rag_children') && text.includes('ILIKE')) {
        return Promise.resolve([
          { id: 'child-kw', content: 'A 与 B 的关键词补充子块', matches: 2 },
        ]);
      }
      if (text.includes('rag_children')) {
        return Promise.resolve([
          { id: 'child-9', content: 'A 与 B 合作的原始子块', similarity: 0.85 },
        ]);
      }
      return Promise.resolve([]);
    }) as never;
    modelLoaderSingleton.models = {
      slice: {
        invoke: async () => sliceResponses.shift() ?? '',
      },
      embedding: {
        embedQuery: async () => [0.1, 0.2],
      },
    } as never;
  };

  const restoreMocks = () => {
    prismaClient.rAGEntity.findMany = originalFindManyEntity;
    prismaClient.rAGGraphEdge.findMany = originalFindManyEdge;
    prismaClient.rAGCommunitySummary.findMany = originalFindManySummary;
    prismaClient.rAGClaim.findMany = originalFindManyClaim;
    prismaClient.$queryRaw = originalQueryRaw;
    modelLoaderSingleton.models = originalModels;
  };

  it('retrieves ranked communities with evidence and a generated answer', async () => {
    installMocks([
      JSON.stringify({ rawQuery: 'A 和 B 的合作背景', entities: ['A'], keywords: ['合作'], themes: [] }),
      JSON.stringify({ selectedCommunityIds: ['c1'] }),
      '答案：A 与 B 存在合作关系',
    ]);

    const service = new GraphRAGRetrievalService();
    try {
      const result = await service.retrieve({ query: 'A 和 B 的合作背景', topK: 5 });

      expect(result.answer).toBe('答案：A 与 B 存在合作关系');
      expect(result.communities.map((community) => community.id)).toEqual(['c1']);
      expect(result.communities[0]?.matchedEntities).toContain('A');
      expect(result.communities[0]?.score).toBeTypeOf('number');
      expect(result.evidence).toEqual([
        {
          claimId: 'claim-1',
          text: 'A 与 B 是多年合作伙伴',
          sourceDocumentId: 'p1',
          sourceChunkId: 'child-1',
        },
        { text: 'A 与 B 合作的原始子块', sourceChunkId: 'child-9' },
        { text: 'A 与 B 的关键词补充子块', sourceChunkId: 'child-kw' },
      ]);
    } finally {
      restoreMocks();
    }
  });

  it('returns community details with members, claims and evidence', async () => {
    installMocks([]);

    const service = new GraphRAGRetrievalService();
    try {
      const details = await service.getCommunityDetails('c1');

      expect(details.id).toBe('c1');
      expect(details.memberEntities).toEqual(['A', 'B']);
      expect(details.summary).toBe('A 与 B 的合作摘要');
      expect(details.relatedEdges.map((edge) => edge.source)).toEqual(['A']);
      expect(details.claims).toEqual([
        {
          id: 'claim-1',
          entityIds: ['A', 'B'],
          text: 'A 与 B 是多年合作伙伴',
          sourceDocumentId: 'p1',
          sourceChunkId: 'child-1',
        },
      ]);
      expect(details.evidence).toEqual([
        {
          claimId: 'claim-1',
          text: 'A 与 B 是多年合作伙伴',
          sourceDocumentId: 'p1',
          sourceChunkId: 'child-1',
        },
      ]);
    } finally {
      restoreMocks();
    }
  });

  it('throws when the requested community is missing', async () => {
    installMocks([]);

    const service = new GraphRAGRetrievalService();
    try {
      await expect(service.getCommunityDetails('missing')).rejects.toThrow();
    } finally {
      restoreMocks();
    }
  });

  it('returns entity neighbors with edge weight and community ids', async () => {
    installMocks([]);

    const service = new GraphRAGRetrievalService();
    try {
      const result = await service.getEntityNeighbors('A', 1);

      expect(result.neighbors).toEqual([
        { entityId: 'eB', entityName: 'B', relationType: '合作', weight: 2 },
      ]);
      expect(result.communityIds).toEqual(['c1']);
    } finally {
      restoreMocks();
    }
  });
});
