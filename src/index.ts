import { GraphRAGRetrievalService } from './retrieval/service/GraphRAGRetrievalService';
import { startBuild } from './build/startBuild';
import { createBuildRegistry } from './build/buildRegistry';
import {
  modelLoader,
  injectModelConfigs,
  envModelConfigs,
  getLoadedModels,
  type ModelLoader,
} from './build/modelLoader';
import {
  registerChatAdapter,
  registerEmbeddingAdapter,
  resolveChatAdapter,
  resolveEmbeddingAdapter,
  resetAdapters,
  type ChatModelAdapter,
  type EmbeddingModelAdapter,
  type ChatAdapterContext,
  type EmbeddingAdapterContext,
} from './build/adapter';
import { prismaClient, injectPrismaClient, getPrismaClient } from './build/helper/prismaClient';
import type { CustomModelConfig } from './build/custom.model.conf.type';
import { configureDefaults } from './config/defaults';

export { GraphRAGRetrievalService, startBuild, createBuildRegistry };
export { modelLoader, injectModelConfigs, envModelConfigs, getLoadedModels };
export {
  registerChatAdapter,
  registerEmbeddingAdapter,
  resolveChatAdapter,
  resolveEmbeddingAdapter,
  resetAdapters,
};
export { prismaClient, injectPrismaClient, getPrismaClient };
export type {
  CustomModelConfig,
  ModelLoader,
  ChatModelAdapter,
  EmbeddingModelAdapter,
  ChatAdapterContext,
  EmbeddingAdapterContext,
};

export const injectGraphRAG = async (options: {
  database?: { client?: import('@prisma/client').PrismaClient; url?: string };
  models?: CustomModelConfig[];
  retrievalDefaults?: Partial<import('./config/defaults').RetrievalDefaults>;
  buildDefaults?: Partial<import('./config/defaults').BuildDefaults>;
} = {}): Promise<void> => {
  if (options.database?.client) {
    injectPrismaClient(options.database.client);
  }

  if (options.database?.url) {
    process.env.DATABASE_URL = options.database.url;
  }

  if (options.models && options.models.length > 0) {
    await injectModelConfigs(options.models);
  }

  if (options.retrievalDefaults || options.buildDefaults) {
    const cfg: { retrieval?: Partial<import('./config/defaults').RetrievalDefaults>; build?: Partial<import('./config/defaults').BuildDefaults> } = {};
    if (options.retrievalDefaults) cfg.retrieval = options.retrievalDefaults;
    if (options.buildDefaults) cfg.build = options.buildDefaults;
    configureDefaults(cfg);
  }
};
