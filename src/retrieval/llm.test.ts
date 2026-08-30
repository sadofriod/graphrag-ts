import { describe, expect, it } from 'bun:test';

import { modelLoaderSingleton } from '../build/modelLoader';
import { invokeSliceModel } from './llm';

describe('invokeSliceModel', () => {
  it('invokes the slice model and returns a string', async () => {
    const originalModels = modelLoaderSingleton.models;

    modelLoaderSingleton.models = {
      embedding: {},
      slice: { invoke: async () => 'hello' },
    } as never;

    try {
      await expect(invokeSliceModel('prompt')).resolves.toBe('hello');
    } finally {
      modelLoaderSingleton.models = originalModels;
    }
  });

  it('throws when the slice model is not loaded', async () => {
    const originalModels = modelLoaderSingleton.models;

    modelLoaderSingleton.models = null;

    try {
      await expect(invokeSliceModel('prompt')).rejects.toThrow(/Slice model is not loaded/);
    } finally {
      modelLoaderSingleton.models = originalModels;
    }
  });
});
