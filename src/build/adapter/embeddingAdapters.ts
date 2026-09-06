import { OpenAIEmbeddings } from '@langchain/openai';
import type { EmbeddingModelAdapter } from './types';

export const openaiEmbeddingAdapter: EmbeddingModelAdapter = ({ config }) =>
  new OpenAIEmbeddings({
    openAIApiKey: config.apiKey,
    modelName: config.model,
    encodingFormat: 'float',
    configuration: {
      baseURL: config.baseURL,
    },
    ...(config.options ?? {}),
  });
