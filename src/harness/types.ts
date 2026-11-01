import type { ChatModelAdapter, EmbeddingModelAdapter } from '../build/adapter/types';

/**
 * One model slot as written in a harness config file (after `${VAR}` interpolation).
 */
export interface HarnessModelSpec {
  provider?: string;
  baseURL?: string;
  model: string;
  apiKey: string;
  options?: Record<string, unknown>;
}

/**
 * A harness describes the provider wiring for a GraphRAG deployment: which chat
 * provider to use for slice/judge, how embeddings are reached, and which
 * adapters must be registered before models are built.
 */
export interface HarnessDefinition {
  id: string;
  description: string;
  chatProvider: string;
  embeddingProvider?: string;
  defaultChatBaseURL?: string;
  defaultEmbeddingBaseURL?: string;
  chatAdapters?: Record<string, ChatModelAdapter>;
  embeddingAdapters?: Record<string, EmbeddingModelAdapter>;
  requiresEmbedding?: boolean;
}

/**
 * Shape of the JSON file a user writes (env refs already resolved).
 */
export interface HarnessFileConfig {
  harness: string;
  database: { url?: string };
  models: { slice?: HarnessModelSpec; judge?: HarnessModelSpec; embedding?: HarnessModelSpec };
  retrievalDefaults?: unknown;
  buildDefaults?: unknown;
}

/**
 * Redacted, log-safe view of what `applyHarness` wired up.
 */
export interface AppliedHarnessSummary {
  harness: string;
  database: { url: string | null };
  models: Array<{
    type: string;
    provider: string;
    baseURL: string;
    model: string;
    apiKey: string;
  }>;
}
