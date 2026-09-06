import { deepseekChatAdapter, openaiChatAdapter } from './chatAdapters';
import { openaiEmbeddingAdapter } from './embeddingAdapters';
import type { ChatModelAdapter, EmbeddingModelAdapter } from './types';

const chatAdapters = new Map<string, ChatModelAdapter>([
  ['deepseek', deepseekChatAdapter],
  ['openai', openaiChatAdapter],
]);

const embeddingAdapters = new Map<string, EmbeddingModelAdapter>([
  ['openai', openaiEmbeddingAdapter],
]);

const DEFAULT_CHAT_PROVIDER = 'deepseek';
const DEFAULT_EMBEDDING_PROVIDER = 'openai';

const normalizeKey = (key: string): string => key.trim().toLowerCase();

export const registerChatAdapter = (provider: string, adapter: ChatModelAdapter): void => {
  chatAdapters.set(normalizeKey(provider), adapter);
};

export const registerEmbeddingAdapter = (
  provider: string,
  adapter: EmbeddingModelAdapter,
): void => {
  embeddingAdapters.set(normalizeKey(provider), adapter);
};

export const resolveChatAdapter = (provider?: string): ChatModelAdapter => {
  if (!provider) {
    const defaultAdapter = chatAdapters.get(DEFAULT_CHAT_PROVIDER);
    if (!defaultAdapter) {
      throw new Error(`Default chat adapter '${DEFAULT_CHAT_PROVIDER}' is not registered.`);
    }
    return defaultAdapter;
  }

  const normalized = normalizeKey(provider);
  const adapter = chatAdapters.get(normalized);
  if (!adapter) {
    throw new Error(
      `Chat model adapter for provider '${provider}' is not registered. Registered providers: ${Array.from(chatAdapters.keys()).join(', ')}`,
    );
  }
  return adapter;
};

export const resolveEmbeddingAdapter = (provider?: string): EmbeddingModelAdapter => {
  if (!provider) {
    const defaultAdapter = embeddingAdapters.get(DEFAULT_EMBEDDING_PROVIDER);
    if (!defaultAdapter) {
      throw new Error(`Default embedding adapter '${DEFAULT_EMBEDDING_PROVIDER}' is not registered.`);
    }
    return defaultAdapter;
  }

  const normalized = normalizeKey(provider);
  const adapter = embeddingAdapters.get(normalized);
  if (!adapter) {
    throw new Error(
      `Embedding model adapter for provider '${provider}' is not registered. Registered providers: ${Array.from(embeddingAdapters.keys()).join(', ')}`,
    );
  }
  return adapter;
};

export const resetAdapters = (): void => {
  chatAdapters.clear();
  chatAdapters.set('deepseek', deepseekChatAdapter);
  chatAdapters.set('openai', openaiChatAdapter);

  embeddingAdapters.clear();
  embeddingAdapters.set('openai', openaiEmbeddingAdapter);
};
