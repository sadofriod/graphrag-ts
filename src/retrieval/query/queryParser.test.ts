import { describe, expect, it } from 'bun:test';

import { modelLoaderSingleton } from '../../build/modelLoader';
import { parseQuery } from './queryParser';

describe('parseQuery', () => {
  it('parses the query through the LLM into a QueryIntent', async () => {
    const originalModels = modelLoaderSingleton.models;

    modelLoaderSingleton.models = {
      embedding: {},
      slice: {
        invoke: async (prompt: string) => {
          expect(prompt).toContain('Apple and Banana partnership background');
          return JSON.stringify({
            entities: ['Apple', 'Banana'],
            keywords: ['apple', 'banana'],
            themes: ['partnership'],
          });
        },
      },
    } as never;

    try {
      const intent = await parseQuery('Apple and Banana partnership background');

      expect(intent.rawQuery).toBe('Apple and Banana partnership background');
      expect(intent.entities).toEqual(['Apple', 'Banana']);
      expect(intent.keywords).toEqual(['apple', 'banana']);
      expect(intent.themes).toEqual(['partnership']);
    } finally {
      modelLoaderSingleton.models = originalModels;
    }
  });

  it('accepts markdown-fenced JSON from the slice model', async () => {
    const originalModels = modelLoaderSingleton.models;

    modelLoaderSingleton.models = {
      embedding: {},
      slice: {
        invoke: async () =>
          '```json\n' +
          JSON.stringify({
            entities: ['Apple'],
            keywords: ['apple'],
            themes: ['partnership'],
          }) +
          '\n```',
      },
    } as never;

    try {
      const intent = await parseQuery('Apple and Banana partnership background');

      expect(intent.entities).toEqual(['Apple']);
    } finally {
      modelLoaderSingleton.models = originalModels;
    }
  });
});
