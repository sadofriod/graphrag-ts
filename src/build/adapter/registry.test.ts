import { beforeEach, describe, expect, it } from 'bun:test';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Embeddings } from '@langchain/core/embeddings';
import {
  registerChatAdapter,
  registerEmbeddingAdapter,
  resolveChatAdapter,
  resolveEmbeddingAdapter,
  resetAdapters,
} from './registry';
import { CustomModelConfigType, type CustomModelConfig } from '../custom.model.conf.type';
import { createModelLoaderFromConfig } from '../modelLoader';

describe('Adapter Registry - Built-in & Custom Adapters', () => {
  beforeEach(() => {
    resetAdapters();
  });

  it('resolves built-in adapters correctly', () => {
    expect(resolveChatAdapter()).toBeTypeOf('function');
    expect(resolveChatAdapter('openai')).toBeTypeOf('function');
    expect(resolveEmbeddingAdapter()).toBeTypeOf('function');
  });

  it('allows registering and resolving a custom chat adapter', () => {
    const customChatAdapter = () =>
      ({
        invoke: async () => 'custom chat response',
      }) as unknown as BaseChatModel;

    registerChatAdapter('anthropic', customChatAdapter);
    const resolved = resolveChatAdapter('anthropic');
    expect(resolved).toBe(customChatAdapter);
  });

  it('allows registering and resolving a custom embedding adapter', () => {
    const customEmbeddingAdapter = () =>
      ({
        embedQuery: async () => [0.1, 0.2, 0.3],
        embedDocuments: async () => [[0.1, 0.2, 0.3]],
      }) as unknown as Embeddings;

    registerEmbeddingAdapter('ollama', customEmbeddingAdapter);
    const resolved = resolveEmbeddingAdapter('ollama');
    expect(resolved).toBe(customEmbeddingAdapter);
  });

  it('throws a helpful error when resolving an unregistered provider', () => {
    expect(() => resolveChatAdapter('unknown-chat-provider')).toThrow(
      /Chat model adapter for provider 'unknown-chat-provider' is not registered/,
    );
    expect(() => resolveEmbeddingAdapter('unknown-embed-provider')).toThrow(
      /Embedding model adapter for provider 'unknown-embed-provider' is not registered/,
    );
  });
});

describe('Adapter Registry - createModelLoaderFromConfig integration', () => {
  beforeEach(() => {
    resetAdapters();
  });

  it('creates ModelLoader using custom registered adapters', async () => {
    const customSlice = { invoke: async () => 'custom slice' } as unknown as BaseChatModel;
    const customJudge = { invoke: async () => 'custom judge' } as unknown as BaseChatModel;
    const customEmbedding = {
      embedQuery: async () => [0.5, 0.5],
      embedDocuments: async () => [[0.5, 0.5]],
    } as unknown as Embeddings;

    registerChatAdapter('custom-provider', ({ config }) =>
      config.type === CustomModelConfigType.slice ? customSlice : customJudge,
    );
    registerEmbeddingAdapter('custom-provider', () => customEmbedding);

    const configs: CustomModelConfig[] = [
      {
        type: CustomModelConfigType.slice,
        baseURL: 'https://custom.ai',
        model: 'custom-slice',
        apiKey: 'key1',
        provider: 'custom-provider',
      },
      {
        type: CustomModelConfigType.judge,
        baseURL: 'https://custom.ai',
        model: 'custom-judge',
        apiKey: 'key2',
        provider: 'custom-provider',
      },
      {
        type: CustomModelConfigType.embedding,
        baseURL: 'https://custom.ai',
        model: 'custom-embed',
        apiKey: 'key3',
        provider: 'custom-provider',
      },
    ];

    const models = await createModelLoaderFromConfig(configs);
    expect(models.slice).toBe(customSlice);
    expect(models.judge).toBe(customJudge);
    expect(models.embedding).toBe(customEmbedding);
  });
});
