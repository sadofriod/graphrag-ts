import { describe, expect, it } from 'bun:test';

import { modelLoaderSingleton } from '../../build/modelLoader';
import { embedText } from './embedding';

describe('embedText', () => {
  it('returns the embedding vector from the loaded embedding model', async () => {
    const originalModels = modelLoaderSingleton.models;

    modelLoaderSingleton.models = {
      embedding: { embedQuery: async () => [0.1, 0.2, 0.3] },
      slice: {},
    } as never;

    try {
      await expect(embedText('hello')).resolves.toEqual([0.1, 0.2, 0.3]);
    } finally {
      modelLoaderSingleton.models = originalModels;
    }
  });

  it('throws when the embedding model is not loaded', async () => {
    const originalModels = modelLoaderSingleton.models;

    modelLoaderSingleton.models = null;

    try {
      await expect(embedText('hello')).rejects.toThrow(/Embedding model is not loaded/);
    } finally {
      modelLoaderSingleton.models = originalModels;
    }
  });
});
