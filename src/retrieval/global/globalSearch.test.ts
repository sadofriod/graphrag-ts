import { afterEach, describe, expect, it } from 'bun:test';

import { prismaClient } from '../../build/helper/prismaClient';
import { modelLoaderSingleton } from '../../build/modelLoader';
import { withNamespace } from '../../namespace/namespaceContext';
import { GraphRAGRetrievalService } from '../service/GraphRAGRetrievalService';

describe('GraphRAGRetrievalService.retrieveGlobal', () => {
  const originalFindMany = prismaClient.rAGCommunitySummary.findMany;
  const originalClaimFindMany = prismaClient.rAGClaim.findMany;
  const originalModels = modelLoaderSingleton.models;
  const queryArgs: unknown[] = [];

  afterEach(() => {
    prismaClient.rAGCommunitySummary.findMany = originalFindMany;
    prismaClient.rAGClaim.findMany = originalClaimFindMany;
    modelLoaderSingleton.models = originalModels;
    queryArgs.length = 0;
  });

  it('maps all summaries at the requested level and reduces the selected answers', async () => {
    prismaClient.rAGCommunitySummary.findMany = ((args: unknown) => {
      queryArgs.push(args);
      return Promise.resolve([
        { id: 'c1', level: 2, parentCommunityId: null, summaryContent: 'Research teams share data across regions.' },
        { id: 'c2', level: 2, parentCommunityId: null, summaryContent: 'Policy groups coordinate regional programs.' },
      ]);
    }) as never;
    prismaClient.rAGClaim.findMany = (() => Promise.resolve([])) as never;

    const prompts: string[] = [];
    modelLoaderSingleton.models = {
      slice: {
        invoke: async (prompt: string) => {
          prompts.push(prompt);
          return prompt.includes('Reduce stage of GraphRAG global retrieval')
            ? JSON.stringify({ answer: 'Several groups coordinate across regions.' })
            : JSON.stringify({ answer: 'Groups coordinate across regions.', usefulness: 85 });
        },
      },
    } as never;

    const result = await withNamespace('ambient-wrong-namespace', () =>
      new GraphRAGRetrievalService().retrieveGlobal({
        namespace: 'global-test',
        query: 'How do groups coordinate?',
        options: { communityLevel: 2 },
      }),
    );

    expect(result.status).toBe('completed');
    expect(result.communityLevel).toBe(2);
    expect(result.answer).toBe('Several groups coordinate across regions.');
    expect(result.selectedMapAnswers[0]?.communityIds.toSorted()).toEqual(['c1', 'c2']);
    expect(prompts.filter((prompt) => prompt.includes('Community ID:')).length).toBeGreaterThan(0);
    expect(prompts.some((prompt) => prompt.includes('Research teams share data'))).toBe(true);
    expect(prompts.some((prompt) => prompt.includes('Policy groups coordinate'))).toBe(true);
    expect(queryArgs[0]).toMatchObject({
      where: { namespace: 'global-test' },
    });
  });

  it('defaults to leaf summaries and avoids model calls when none are available', async () => {
    prismaClient.rAGCommunitySummary.findMany = ((args: unknown) => {
      queryArgs.push(args);
      return Promise.resolve([]);
    }) as never;
    prismaClient.rAGClaim.findMany = (() => Promise.resolve([])) as never;
    let calls = 0;
    modelLoaderSingleton.models = {
      slice: { invoke: async () => { calls += 1; return ''; } },
    } as never;

    const result = await new GraphRAGRetrievalService().retrieveGlobal({
      namespace: 'global-empty-test',
      query: 'global question',
    });

    expect(result).toMatchObject({
      communityLevel: 'leaf',
      status: 'no_results',
      selectedMapAnswers: [],
      failedMapBatches: 0,
    });
    expect(result.answer).toContain('No relevant community summaries');
    expect((queryArgs[0] as { where?: { level?: number } }).where?.level).toBeUndefined();
    expect(calls).toBe(0);
  });

  it('does not reduce when all Map scores are zero', async () => {
    prismaClient.rAGCommunitySummary.findMany = (() => Promise.resolve([
      { id: 'c1', summaryContent: 'Unrelated information.' },
    ])) as never;
    prismaClient.rAGClaim.findMany = (() => Promise.resolve([])) as never;
    let calls = 0;
    modelLoaderSingleton.models = {
      slice: {
        invoke: async () => {
          calls += 1;
          return JSON.stringify({ answer: '', usefulness: 0 });
        },
      },
    } as never;

    const result = await new GraphRAGRetrievalService().retrieveGlobal({
      namespace: 'global-zero-score-test',
      query: 'global question',
    });

    expect(result.status).toBe('no_results');
    expect(result.selectedMapAnswers).toEqual([]);
    expect(calls).toBe(1);
  });

  it('maps leaf summaries with their assigned claims and source chunks', async () => {
    prismaClient.rAGCommunitySummary.findMany = ((args: unknown) => {
      queryArgs.push(args);
      return Promise.resolve([
        { id: 'root', level: 0, summaryContent: 'Broad summary.', parentCommunityId: null },
        { id: 'child', level: 1, summaryContent: 'Mid-level summary.', parentCommunityId: 'root' },
        { id: 'leaf', level: 2, summaryContent: 'Leaf summary.', parentCommunityId: 'child' },
      ]);
    }) as never;
    prismaClient.rAGClaim.findMany = ((args: unknown) => {
      queryArgs.push(args);
      return Promise.resolve([{
        communitySummaryId: 'leaf',
        description: 'Dormouse describes three little sisters.',
        subjectEntity: { name: 'Dormouse' },
        objectEntity: null,
        sourceChunk: { content: 'There were three little sisters.' },
      }]);
    }) as never;

    const prompts: string[] = [];
    modelLoaderSingleton.models = {
      slice: {
        invoke: async (prompt: string) => {
          prompts.push(prompt);
          return prompt.includes('Reduce stage of GraphRAG global retrieval')
            ? JSON.stringify({ answer: 'Three little sisters.' })
            : JSON.stringify({ answer: 'Three little sisters.', usefulness: 90 });
        },
      },
    } as never;

    const result = await new GraphRAGRetrievalService().retrieveGlobal({
      namespace: 'global-leaf-test',
      query: 'What did the Dormouse describe?',
    });

    expect(result.communityLevel).toBe('leaf');
    expect((queryArgs[0] as { where?: { level?: number } }).where?.level).toBeUndefined();
    expect(queryArgs[1]).toMatchObject({
      where: { communitySummaryId: { in: ['leaf'] } },
    });
    expect(prompts.some((prompt) => prompt.includes('Leaf summary.'))).toBe(true);
    expect(prompts.some((prompt) => prompt.includes('Broad summary.'))).toBe(false);
    expect(prompts.some((prompt) => prompt.includes('There were three little sisters.'))).toBe(true);

    queryArgs.length = 0;
    prompts.length = 0;
    const levelResult = await new GraphRAGRetrievalService().retrieveGlobal({
      namespace: 'global-level-test',
      query: 'What did the Dormouse describe?',
      options: { communityLevel: 0 },
    });

    expect(levelResult.communityLevel).toBe(0);
    expect(queryArgs[1]).toMatchObject({
      where: { communitySummaryId: { in: ['leaf'] } },
    });
    expect(prompts.some((prompt) => prompt.includes('Broad summary.'))).toBe(true);
    expect(prompts.some((prompt) => prompt.includes('There were three little sisters.'))).toBe(true);
  });
});
