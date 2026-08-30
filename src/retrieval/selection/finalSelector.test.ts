import { describe, expect, it } from 'bun:test';

import { modelLoaderSingleton } from '../../build/modelLoader';
import type { RankedCommunity } from '../types/retrieval';
import { llmFilterCommunities, selectFinalCommunities } from './finalSelector';

const ranked: RankedCommunity[] = [
  { id: 'c1', members: ['A'], summary: 's1', score: 0.9, matchedEntities: ['A'] },
  { id: 'c2', members: ['B'], summary: 's2', score: 0.5, matchedEntities: [] },
];

describe('selectFinalCommunities', () => {
  it('keeps the ranked communities in the rule-based path', async () => {
    await expect(selectFinalCommunities('q', ranked)).resolves.toEqual(ranked);
  });

  it('filters via the LLM when llmSelect is true', async () => {
    const originalModels = modelLoaderSingleton.models;

    modelLoaderSingleton.models = {
      embedding: {},
      slice: {
        invoke: async (prompt: string) => {
          expect(prompt).toContain('c1');
          return JSON.stringify({ selectedCommunityIds: ['c1'] });
        },
      },
    } as never;

    try {
      const result = await selectFinalCommunities('q', ranked, true);

      expect(result.map((community) => community.id)).toEqual(['c1']);
    } finally {
      modelLoaderSingleton.models = originalModels;
    }
  });
});

describe('llmFilterCommunities', () => {
  it('filters communities through the LLM', async () => {
    const originalModels = modelLoaderSingleton.models;

    modelLoaderSingleton.models = {
      embedding: {},
      slice: {
        invoke: async () => JSON.stringify({ selectedCommunityIds: ['c2'] }),
      },
    } as never;

    try {
      const result = await llmFilterCommunities('q', ranked);

      expect(result.map((community) => community.id)).toEqual(['c2']);
    } finally {
      modelLoaderSingleton.models = originalModels;
    }
  });

  it('accepts markdown-fenced JSON from the slice model', async () => {
    const originalModels = modelLoaderSingleton.models;

    modelLoaderSingleton.models = {
      embedding: {},
      slice: {
        invoke: async () => '```json\n{"selectedCommunityIds":["c2"]}\n```',
      },
    } as never;

    try {
      const result = await llmFilterCommunities('q', ranked);

      expect(result.map((community) => community.id)).toEqual(['c2']);
    } finally {
      modelLoaderSingleton.models = originalModels;
    }
  });
});
