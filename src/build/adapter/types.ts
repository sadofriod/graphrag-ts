import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Embeddings } from '@langchain/core/embeddings';
import type { CustomModelConfig } from '../custom.model.conf.type';

export interface ChatAdapterContext {
  config: CustomModelConfig;
  isSlice?: boolean;
}

export interface EmbeddingAdapterContext {
  config: CustomModelConfig;
}

export type ChatModelAdapter = (context: ChatAdapterContext) => BaseChatModel;
export type EmbeddingModelAdapter = (context: EmbeddingAdapterContext) => Embeddings;
