import { afterEach, describe, expect, it } from 'bun:test';

import { prismaClient } from '../../build/helper/prismaClient';
import { modelLoaderSingleton } from '../../build/modelLoader';
import { withNamespace } from '../../namespace/namespaceContext';
import { GraphRAGRetrievalService } from '../service/GraphRAGRetrievalService';

describe('GraphRAGRetrievalService.retrieveGlobal', () => {
  const originalFindMany = prismaClient.rAGCommunitySummary.findMany;
  const originalModels = modelLoaderSingleton.models;
  const queryArgs: unknown[] = [];

  afterEach(() => {
    prismaClient.rAGCommunitySummary.findMany = originalFindMany;
    modelLoaderSingleton.models = originalModels;
    queryArgs.length = 0;
  });

  it('maps all summaries at the requested level and reduces the selected answers', async () => {
    prismaClient.rAGCommunitySummary.findMany = ((args: unknown) => {
      queryArgs.push(args);
      return Promise.resolve([
        { id: 'c1', summaryContent: 'Research teams share data across regions.' },
        { id: 'c2', summaryContent: 'Policy groups coordinate regional programs.' },
      ]);
    }) as never;

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
      where: { namespace: 'global-test', level: 2 },
    });
  });

  it('defaults to level zero and avoids model calls when the selected level has no summaries', async () => {
    prismaClient.rAGCommunitySummary.findMany = ((args: unknown) => {
      queryArgs.push(args);
      return Promise.resolve([]);
    }) as never;
    let calls = 0;
    modelLoaderSingleton.models = {
      slice: { invoke: async () => { calls += 1; return ''; } },
    } as never;

    const result = await new GraphRAGRetrievalService().retrieveGlobal({
      namespace: 'global-empty-test',
      query: 'global question',
    });

    expect(result).toMatchObject({
      communityLevel: 0,
      status: 'no_results',
      selectedMapAnswers: [],
      failedMapBatches: 0,
    });
    expect(result.answer).toContain('No relevant community summaries');
    expect((queryArgs[0] as { where?: { level?: number } }).where?.level).toBe(0);
    expect(calls).toBe(0);
  });

  it('does not reduce when all Map scores are zero', async () => {
    prismaClient.rAGCommunitySummary.findMany = (() => Promise.resolve([
      { id: 'c1', summaryContent: 'Unrelated information.' },
    ])) as never;
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
});
