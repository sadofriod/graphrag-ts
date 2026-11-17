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

  it('keeps Map prompts stable across row ordering and snapshot row-ID changes', async () => {
    let prefix = 'original';
    let reversed = false;
    prismaClient.rAGCommunitySummary.findMany = (async () => {
      const rows = ['A', 'B'].map((member) => ({
        id: `${prefix}-${member}`, members: [member], level: 0,
        parentCommunityId: null, summaryContent: `${member} summary`,
      }));
      return reversed ? rows.toReversed() : rows;
    }) as never;
    prismaClient.rAGClaim.findMany = (async () => {
      const rows = ['first', 'second'].map((description) => ({
        communitySummaryId: `${prefix}-A`, description,
        subjectEntity: { name: 'A' }, objectEntity: null, sourceChunk: { content: description },
      }));
      return reversed ? rows.toReversed() : rows;
    }) as never;
    const prompts: string[] = [];
    modelLoaderSingleton.models = { slice: { invoke: async (prompt: string) => {
      prompts.push(prompt);
      return JSON.stringify({ answer: '', usefulness: 0 });
    } } } as never;
    const service = new GraphRAGRetrievalService();
    await service.retrieveGlobal({ namespace: 'original', query: 'same question' });
    reversed = true;
    await service.retrieveGlobal({ namespace: 'original', query: 'same question' });
    prefix = 'clone';
    await service.retrieveGlobal({ namespace: 'clone', query: 'same question' });
    expect(prompts).toHaveLength(3);
    expect(prompts[1]).toBe(prompts[0]);
    expect(prompts[2]).toBe(prompts[0]);
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
    expect(result.failedCommunities).toEqual([]);
    expect(result.retainedCommunities.toSorted()).toEqual(['c1', 'c2']);
    expect(result.droppedForBudget).toEqual([]);
    expect(result.budgetLimited).toBe(false);
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
      failedCommunities: [],
      retainedCommunities: [],
      droppedForBudget: [],
      budgetLimited: false,
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
    expect(result.failedCommunities).toEqual([]);
    expect(calls).toBe(1);
  });

  it('reports the communities lost when one disjoint Map batch fails', async () => {
    prismaClient.rAGCommunitySummary.findMany = (() => Promise.resolve([
      { id: 'lost-topic', level: 0, parentCommunityId: null, summaryContent: `Lost topic. ${'lost details '.repeat(70)}` },
      { id: 'retained-topic', level: 0, parentCommunityId: null, summaryContent: `Retained topic. ${'retained details '.repeat(70)}` },
    ])) as never;
    prismaClient.rAGClaim.findMany = (() => Promise.resolve([])) as never;
    const prompts: string[] = [];
    modelLoaderSingleton.models = {
      slice: {
        invoke: async (prompt: string) => {
          prompts.push(prompt);
          if (prompt.includes('lost details')) throw new Error('lost-topic Map failure');
          return prompt.includes('Reduce stage of GraphRAG global retrieval')
            ? JSON.stringify({ answer: 'Only the retained topic is covered.' })
            : JSON.stringify({ answer: 'Retained topic details.', usefulness: 90 });
        },
      },
    } as never;

    const result = await new GraphRAGRetrievalService().retrieveGlobal({
      namespace: 'global-partial-coverage-test',
      query: 'Summarize both topics.',
      options: { communityLevel: 0, mapTokenBudget: 600, mapOutputReserve: 0 },
    });

    expect(result.status).toBe('partial');
    expect(result.failedMapBatches).toBeGreaterThanOrEqual(1);
    expect(result.failedCommunities).toContain('lost-topic');
    expect(result.retainedCommunities).not.toContain('lost-topic');
    expect(result.budgetLimited).toBe(false);
    expect(prompts.some((prompt) =>
      prompt.includes('Coverage gap:') && prompt.includes('lost-topic') && prompt.includes('missing'),
    )).toBe(true);
  });

  it('limits failed community IDs in the Reduce note while retaining surviving answers', async () => {
    const failedIds = Array.from({ length: 100 }, (_, index) => `lost-topic-${index.toString().padStart(3, '0')}`);
    prismaClient.rAGCommunitySummary.findMany = (() => Promise.resolve([
      { id: 'retained-topic', level: 0, parentCommunityId: null, summaryContent: `Retained topic. ${'retained details '.repeat(200)}` },
      ...failedIds.map((id) => ({
        id,
        level: 0,
        parentCommunityId: null,
        summaryContent: `Lost topic. ${'lost details '.repeat(70)}`,
      })),
    ])) as never;
    prismaClient.rAGClaim.findMany = (() => Promise.resolve([])) as never;
    const prompts: string[] = [];
    modelLoaderSingleton.models = {
      slice: {
        invoke: async (prompt: string) => {
          prompts.push(prompt);
          if (prompt.includes('lost details')) throw new Error('lost-topic Map failure');
          return prompt.includes('Reduce stage of GraphRAG global retrieval')
            ? JSON.stringify({ answer: 'Only the retained topic is covered.' })
            : JSON.stringify({ answer: 'Retained topic details.', usefulness: 90 });
        },
      },
    } as never;

    const result = await new GraphRAGRetrievalService().retrieveGlobal({
      namespace: 'global-bounded-coverage-test',
      query: 'Summarize all topics.',
      options: { communityLevel: 0, mapTokenBudget: 600, mapOutputReserve: 0 },
    });
    const reducePrompt = prompts.find((prompt) => prompt.includes('Reduce stage of GraphRAG global retrieval'));

    expect(result.status).toBe('partial');
    expect(result.failedCommunities).toHaveLength(failedIds.length);
    expect(result.selectedMapAnswers.map(({ communityIds }) => communityIds).flat()).toContain('retained-topic');
    const notedIds = reducePrompt?.match(/lost-topic-\d{3}/g) ?? [];
    expect(notedIds.length).toBeGreaterThan(0);
    expect(notedIds.length).toBeLessThan(failedIds.length);
    expect(reducePrompt).toContain('IDs omitted');
  });

  it('reports Reduce budget omissions without making status partial', async () => {
    prismaClient.rAGCommunitySummary.findMany = (() => Promise.resolve([
      { id: 'budget-one', level: 0, parentCommunityId: null, summaryContent: `First topic. ${'first details '.repeat(70)}` },
      { id: 'budget-two', level: 0, parentCommunityId: null, summaryContent: `Second topic. ${'second details '.repeat(70)}` },
    ])) as never;
    prismaClient.rAGClaim.findMany = (() => Promise.resolve([])) as never;
    modelLoaderSingleton.models = {
      slice: {
        invoke: async (prompt: string) => prompt.includes('Reduce stage of GraphRAG global retrieval')
          ? JSON.stringify({ answer: 'A partial synthesis.' })
          : JSON.stringify({ answer: 'A useful answer. '.repeat(8), usefulness: 90 }),
      },
    } as never;

    const result = await new GraphRAGRetrievalService().retrieveGlobal({
      namespace: 'global-budget-coverage-test',
      query: 'Summarize the topics.',
      options: {
        communityLevel: 0,
        mapTokenBudget: 450,
        mapOutputReserve: 0,
        reduceTokenBudget: 250,
        reduceOutputReserve: 0,
      },
    });

    expect(result.droppedForBudget.length).toBeGreaterThan(0);
    expect(result.budgetLimited).toBe(true);
    expect(result.status).toBe('completed');
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
