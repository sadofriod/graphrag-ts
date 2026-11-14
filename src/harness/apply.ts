import { PrismaClient } from '@prisma/client';

import { registerChatAdapter, registerEmbeddingAdapter } from '../build/adapter/registry';
import { injectPrismaClient } from '../build/helper/prismaClient';
import { injectModelConfigs, type ModelLoader } from '../build/modelLoader';
import { configureDefaults, type BuildDefaults, type RetrievalDefaults } from '../config/defaults';
import { planHarness } from './plan';
import type { AppliedHarnessSummary, HarnessDefinition, HarnessFileConfig } from './types';

export { maskDatabaseUrl, planHarness } from './plan';
export type { HarnessPlan } from './plan';

export interface AppliedHarness {
  harness: HarnessDefinition;
  models: ModelLoader;
  prisma: PrismaClient;
  summary: AppliedHarnessSummary;
  /**
   * Disconnects the Prisma client only when `applyHarness` created it. A client
   * injected through `database.client` belongs to the caller: `close()` does not
   * disconnect it and resolves immediately, so the caller's shutdown path stays
   * the single owner. Repeated calls return the same promise.
   */
  close: () => Promise<void>;
}

export interface ApplyHarnessOptions {
  config: HarnessFileConfig;
  configPath?: string;
  /** Injected client: used as-is and never disconnected by the returned `close()`. */
  database?: { client?: PrismaClient };
  registerAdapters?: boolean;
}

const registerDefinitionAdapters = (definition: HarnessDefinition): void => {
  for (const [provider, adapter] of Object.entries(definition.chatAdapters ?? {})) {
    registerChatAdapter(provider, adapter);
  }
  for (const [provider, adapter] of Object.entries(definition.embeddingAdapters ?? {})) {
    registerEmbeddingAdapter(provider, adapter);
  }
};

interface ResolvedPrisma {
  client: PrismaClient;
  /** True when this call created the client and therefore owns disconnecting it. */
  owned: boolean;
}

const resolvePrismaClient = (
  options: ApplyHarnessOptions,
  config: HarnessFileConfig,
): ResolvedPrisma => {
  const injected = options.database?.client;
  if (injected) return { client: injected, owned: false };

  const url = config.database.url;
  if (!url) {
    throw new Error(
      'No database configured. Set database.url in the harness config or pass database.client to applyHarness().',
    );
  }

  // Use datasourceUrl instead of DATABASE_URL so import order cannot change the target database.
  return { client: new PrismaClient({ datasourceUrl: url }), owned: true };
};

/**
 * Wires models and the database from a harness config, without touching
 * `process.env`: models are injected via `injectModelConfigs`, the client via
 * `injectPrismaClient`.
 *
 * `close()` disconnects only a Prisma client this call created; a client passed
 * as `database.client` is left open for the caller to manage.
 */
export const applyHarness = async (options: ApplyHarnessOptions): Promise<AppliedHarness> => {
  const { config } = options;
  const plan = await planHarness({
    config,
    ...(options.configPath === undefined ? {} : { configPath: options.configPath }),
  });

  if (options.registerAdapters !== false) {
    registerDefinitionAdapters(plan.definition);
  }

  const database = resolvePrismaClient(options, config);
  const prisma = database.client;

  await prisma.$connect();
  let models: ModelLoader;
  try {
    models = await injectModelConfigs(plan.configs);
  } catch (error) {
    if (database.owned) {
      await prisma.$disconnect().catch(() => undefined);
    }
    throw error;
  }
  injectPrismaClient(prisma);

  if (config.retrievalDefaults !== undefined || config.buildDefaults !== undefined) {
    configureDefaults({
      ...(config.retrievalDefaults === undefined
        ? {}
        : { retrieval: config.retrievalDefaults as Partial<RetrievalDefaults> }),
      ...(config.buildDefaults === undefined
        ? {}
        : { build: config.buildDefaults as Partial<BuildDefaults> }),
    });
  }

  let closePromise: Promise<void> | null = null;
  const close = (): Promise<void> => {
    if (!closePromise) {
      // An injected client is the caller's to disconnect; only our own is ours to close.
      closePromise = database.owned
        ? prisma.$disconnect().then(() => undefined)
        : Promise.resolve();
    }
    return closePromise;
  };

  return {
    harness: plan.definition,
    models,
    prisma,
    summary: plan.summary,
    close,
  };
};
