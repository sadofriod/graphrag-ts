import { ChatDeepSeek } from '@langchain/deepseek';
import { OpenAIEmbeddings } from '@langchain/openai';
import { CustomModelConfigType, type CustomModelConfig } from './custom.model.conf.type';
import { logger } from '../logger';
import { createLLMCallLogger } from './llmCallbacks';
import { LLM_TIMEOUT_MS } from './constants';

/** slice/judge are chat models, embedding is a vector model (narrowed by config type). */
interface ModelLoader {
  slice: ChatDeepSeek;
  judge: ChatDeepSeek;
  embedding: OpenAIEmbeddings;
}

/** Invoke a chat model and extract plain text (handles string and AIMessage returns). */
export const invokeModelText = async (model: ChatDeepSeek, prompt: string): Promise<string> => {
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
  return {
    type,
    baseURL: envOr(`${prefix}_BASE_URL`, 'https://api.deepseek.com/'),
    model: envOr(`${prefix}_MODEL`, 'deepseek-chat'),
    apiKey,
  };
};

const embeddingConfig = (): CustomModelConfig | undefined => {
  const apiKey = envOr('RAG_EMBED_API_KEY');
  if (!apiKey) return undefined;
  return {
    type: CustomModelConfigType.embedding,
    baseURL: envOr('RAG_EMBED_BASE_URL', 'http://127.0.0.1:1234/v1'),
    model: envOr('RAG_EMBED_MODEL', 'local-embedding-model'),
    apiKey,
  };
};

/** Build the model configuration from environment variables (see .env.example). */
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
      acc[conf.type] = new OpenAIEmbeddings({
        openAIApiKey: conf.apiKey,
        modelName: conf.model,
        // The OpenAI SDK sends encoding_format=base64 by default and decodes it itself.
        // LM Studio ignores that parameter and returns raw float arrays, which get
        // misdecoded (all zeros). Requesting float explicitly lets the SDK pass them through.
        encodingFormat: 'float',
        configuration: {
          baseURL: conf.baseURL,
        },
      });
      return acc;
    }
    acc[conf.type] = new ChatDeepSeek({
      apiKey: conf.apiKey,
      model: conf.model,
      callbacks: [createLLMCallLogger()],
      // Timeout protection: LLM slicing can take minutes. Fail fast and fall back to
      // deterministic splitting instead of waiting indefinitely.
      timeout: LLM_TIMEOUT_MS,
      // DeepSeek JSON mode: force valid JSON so slicing/summary outputs are JSON rather
      // than free text (which would otherwise fall back to deterministic splitting).
      // Note: DeepSeek's default thinking mode does not support tool_choice (function
      // calling), so withStructuredOutput is unavailable; response_format=json_object is
      // the compatible structured-output option.
      ...(conf.type === CustomModelConfigType.slice
        ? { modelKwargs: { response_format: { type: 'json_object' } as const } }
        : {}),
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
