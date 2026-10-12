import { describe, expect, it } from 'bun:test';

import { modelLoaderSingleton } from '../build/modelLoader';
import { invokeSliceModel } from './llm';

const textInvocation = {
  inputFormat: 'text' as const,
  prompt: 'prompt',
  outputFormat: { type: 'text' as const },
};

const jsonInvocation = {
  inputFormat: 'text' as const,
  prompt: 'Return a JSON object with answer.',
  outputFormat: {
    type: 'json_object' as const,
    schema: {
      type: 'object' as const,
      required: ['answer'],
      properties: { answer: { type: 'string' as const } },
    },
  },
};

describe('invokeSliceModel', () => {
  it('invokes the slice model and returns a string', async () => {
    const originalModels = modelLoaderSingleton.models;

    modelLoaderSingleton.models = {
      embedding: {},
      slice: { invoke: async () => 'hello' },
    } as never;

    try {
      await expect(invokeSliceModel(textInvocation)).resolves.toBe('hello');
    } finally {
      modelLoaderSingleton.models = originalModels;
    }
  });

  it('throws when the slice model is not loaded', async () => {
    const originalModels = modelLoaderSingleton.models;

    modelLoaderSingleton.models = null;

    try {
      await expect(invokeSliceModel(textInvocation)).rejects.toThrow(/Slice model is not loaded/);
    } finally {
      modelLoaderSingleton.models = originalModels;
    }
  });

  it('binds JSON response mode only for a JSON-formatted invocation', async () => {
    const originalModels = modelLoaderSingleton.models;
    let boundResponseFormat: unknown;
    const model = {
      bind: (options: { response_format: unknown }) => {
        boundResponseFormat = options.response_format;
        return { invoke: async () => '{"answer":"ok"}' };
      },
    };
    modelLoaderSingleton.models = { slice: model } as never;

    try {
      await expect(invokeSliceModel(jsonInvocation)).resolves.toBe('{"answer":"ok"}');
      expect(boundResponseFormat).toEqual({ type: 'json_object' });
    } finally {
      modelLoaderSingleton.models = originalModels;
    }
  });
});
