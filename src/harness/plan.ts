import { CustomModelConfigType, type CustomModelConfig } from '../build/custom.model.conf.type';
import { maskSecret, resolveHarnessDefinition } from './config';
import type {
  AppliedHarnessSummary,
  HarnessDefinition,
  HarnessFileConfig,
  HarnessModelSpec,
} from './types';

const DEEPSEEK_EMBEDDING_MESSAGE =
  'DeepSeek provides no embedding API. Set models.embedding (provider, baseURL, model, apiKey) to your own OpenAI-compatible embedding endpoint with 768-dimensional output.';

/**
 * Everything `applyHarness` can decide without side effects: the resolved harness
 * definition, the model configs it would build and the redacted summary.
 */
export interface HarnessPlan {
  definition: HarnessDefinition;
  configs: CustomModelConfig[];
  summary: AppliedHarnessSummary;
}

const chatConfig = (
  type: CustomModelConfigType.slice | CustomModelConfigType.judge,
  spec: HarnessModelSpec,
  definition: HarnessDefinition,
): CustomModelConfig => {
  const label = `models.${type}`;
  const baseURL = spec.baseURL ?? definition.defaultChatBaseURL;
  if (!baseURL) {
    throw new Error(
      `Missing baseURL for ${label}. Set ${label}.baseURL in the harness config or declare defaultChatBaseURL on harness '${definition.id}'.`,
    );
  }

  return {
    type,
    baseURL,
    model: spec.model,
    apiKey: spec.apiKey,
    provider: spec.provider ?? definition.chatProvider,
    ...(spec.options === undefined ? {} : { options: spec.options }),
  };
};

const embeddingConfig = (
  spec: HarnessModelSpec,
  definition: HarnessDefinition,
): CustomModelConfig => {
  const baseURL = spec.baseURL ?? definition.defaultEmbeddingBaseURL;
  if (!baseURL) {
    throw new Error(
      'Missing baseURL for models.embedding. Set models.embedding.baseURL to your OpenAI-compatible embedding endpoint.',
    );
  }

  const provider = spec.provider ?? definition.embeddingProvider;

  return {
    type: CustomModelConfigType.embedding,
    baseURL,
    model: spec.model,
    apiKey: spec.apiKey,
    ...(provider === undefined ? {} : { provider }),
    ...(spec.options === undefined ? {} : { options: spec.options }),
  };
};

const missingEmbeddingError = (definition: HarnessDefinition): Error =>
  definition.id === 'deepseek'
    ? new Error(DEEPSEEK_EMBEDDING_MESSAGE)
    : new Error(
        `Harness '${definition.id}' requires an embedding model. Set models.embedding (provider, baseURL, model, apiKey) in the harness config.`,
      );

const buildModelConfigs = (
  definition: HarnessDefinition,
  config: HarnessFileConfig,
): CustomModelConfig[] => {
  const configs: CustomModelConfig[] = [];

  const slice = config.models.slice;
  if (!slice) {
    throw new Error('Missing models.slice. Set models.slice (model, apiKey) in the harness config.');
  }
  const judge = config.models.judge;
  if (!judge) {
    throw new Error('Missing models.judge. Set models.judge (model, apiKey) in the harness config.');
  }

  configs.push(chatConfig(CustomModelConfigType.slice, slice, definition));
  configs.push(chatConfig(CustomModelConfigType.judge, judge, definition));

  const embedding = config.models.embedding;
  if (!embedding) {
    if (definition.requiresEmbedding !== false) {
      throw missingEmbeddingError(definition);
    }
    return configs;
  }

  configs.push(embeddingConfig(embedding, definition));
  return configs;
};

/**
 * Log-safe rendering of a database URL: keeps the scheme, user, host, port, path
 * and non-secret query parameters, masks the password and any query parameter
 * whose name looks secret. Unparseable input falls back to `maskSecret`, which
 * reduces a short URL to `***`.
 */
export const maskDatabaseUrl = (url: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return maskSecret(url);
  }

  if (parsed.password !== '') parsed.password = '***';
  for (const key of Array.from(parsed.searchParams.keys())) {
    if (/password|secret|token|key/i.test(key)) parsed.searchParams.set(key, '***');
  }
  return parsed.toString();
};

const toSummary = (
  harnessId: string,
  config: HarnessFileConfig,
  configs: CustomModelConfig[],
): AppliedHarnessSummary => ({
  harness: harnessId,
  database: { url: config.database.url ? maskDatabaseUrl(config.database.url) : null },
  models: configs.map((conf) => ({
    type: conf.type,
    provider: conf.provider ?? '',
    baseURL: conf.baseURL,
    model: conf.model,
    apiKey: maskSecret(conf.apiKey),
  })),
});

/**
 * Resolves the harness definition and builds the model configs and summary it
 * implies, without any side effect: no adapter registration, no database
 * connection, no global injection. Safe to use for `--check` style validation.
 *
 * This module deliberately imports no Prisma client and no model loader, so
 * planning never opens a connection or initialises provider clients.
 */
export const planHarness = async (options: {
  config: HarnessFileConfig;
  configPath?: string;
}): Promise<HarnessPlan> => {
  const { config } = options;
  const definition = await resolveHarnessDefinition(config.harness, options.configPath);
  const configs = buildModelConfigs(definition, config);

  return {
    definition,
    configs,
    summary: toSummary(definition.id, config, configs),
  };
};
