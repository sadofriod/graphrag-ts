import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Embeddings } from '@langchain/core/embeddings';
import { CustomModelConfigType, type CustomModelConfig } from './custom.model.conf.type';
import { logger } from '../logger';
import { resolveChatAdapter, resolveEmbeddingAdapter } from './adapter';

export interface ModelLoader {
  slice: BaseChatModel;
  judge: BaseChatModel;
  embedding: Embeddings;
}

export const invokeModelText = async (model: BaseChatModel, prompt: string): Promise<string> => {
  const response = await model.invoke(prompt);
  if (typeof response === 'string') return response;
  const content = (response as { content?: unknown }).content;
  return typeof content === 'string' ? content : JSON.stringify(content ?? '');
};

const envOr = (name: string, fallback = ''): string => process.env[name] ?? fallback;

const chatConfig = (
  type: CustomModelConfigType.slice | CustomModelConfigType.judge,
): CustomModelConfig | undefined => {
  const prefix = type === CustomModelConfigType.slice ? 'RAG_SLICE' : 'RAG_JUDGE';
  const apiKey = envOr(`${prefix}_API_KEY`);
  if (!apiKey) return undefined;
  const provider = envOr(`${prefix}_PROVIDER`);
  return {
    type,
    baseURL: envOr(`${prefix}_BASE_URL`, 'https://api.deepseek.com/'),
    model: envOr(`${prefix}_MODEL`, 'deepseek-chat'),
    apiKey,
    ...(provider ? { provider } : {}),
  };
};

const embeddingConfig = (): CustomModelConfig | undefined => {
  const apiKey = envOr('RAG_EMBED_API_KEY');
  if (!apiKey) return undefined;
  const provider = envOr('RAG_EMBED_PROVIDER');
  return {
    type: CustomModelConfigType.embedding,
    baseURL: envOr('RAG_EMBED_BASE_URL', 'http://127.0.0.1:1234/v1'),
    model: envOr('RAG_EMBED_MODEL', 'local-embedding-model'),
    apiKey,
    ...(provider ? { provider } : {}),
  };
};

export const envModelConfigs = (): CustomModelConfig[] =>
  [
    chatConfig(CustomModelConfigType.slice),
    chatConfig(CustomModelConfigType.judge),
    embeddingConfig(),
  ].filter((config): config is CustomModelConfig => config !== undefined);

export const createModelLoaderFromConfig = async (
  configs: CustomModelConfig[],
): Promise<ModelLoader> => {
  if (configs.length === 0) {
    throw new Error(
      'No model configuration found. Set RAG_SLICE_API_KEY / RAG_JUDGE_API_KEY / RAG_EMBED_API_KEY (see .env.example).',
    );
  }
  return configs.reduce((acc, conf) => {
    if (conf.type === CustomModelConfigType.embedding) {
      const adapter = resolveEmbeddingAdapter(conf.provider);
      acc[conf.type] = adapter({ config: conf });
      return acc;
    }
    const adapter = resolveChatAdapter(conf.provider);
    acc[conf.type] = adapter({
      config: conf,
      isSlice: conf.type === CustomModelConfigType.slice,
    });
    return acc;
  }, {} as ModelLoader);
};

export const modelLoader = async (configs: CustomModelConfig[] = envModelConfigs()): Promise<ModelLoader> =>
  createModelLoaderFromConfig(configs);

export const injectModelConfigs = async (configs: CustomModelConfig[]): Promise<ModelLoader> => {
  const loaded = await createModelLoaderFromConfig(configs);
  modelLoaderSingleton.models = loaded;
  return loaded;
};

export const getLoadedModels = (): ModelLoader | null => modelLoaderSingleton.models;

class ModelLoaderSingleton {
  models: ModelLoader | null = null;
  constructor() {
    modelLoader()
      .then((models) => {
        this.models = models;
      })
      .catch((error) => {
        logger.error('Failed to load models:', error);
      });
  }
}

export const modelLoaderSingleton = new ModelLoaderSingleton();
