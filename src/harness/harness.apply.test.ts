import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import type { Embeddings } from '@langchain/core/embeddings';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { PrismaClient } from '@prisma/client';

import { getPrismaClient } from '../../src/build/helper/prismaClient';
import { resetAdapters, resolveChatAdapter } from '../build/adapter/registry';
import { getLoadedModels } from '../build/modelLoader';
import { applyHarness, maskDatabaseUrl, planHarness } from './apply';
import { maskSecret, validateHarnessConfig } from './config';
import { defineHarness } from './defineHarness';
import { registerHarness, resetHarnesses } from './registry';

const DEEPSEEK_EMBEDDING_MESSAGE =
  'DeepSeek provides no embedding API. Set models.embedding (provider, baseURL, model, apiKey) to your own OpenAI-compatible embedding endpoint with 768-dimensional output.';

const fakeChatModel = (label: string): BaseChatModel =>
  ({ label, invoke: async () => label } as unknown as BaseChatModel);

const fakeEmbeddings = (label: string): Embeddings =>
  ({ label, embedDocuments: async () => [], embedQuery: async () => [] } as unknown as Embeddings);

interface StubPrisma {
  client: PrismaClient;
  calls: { connect: number; disconnect: number };
}

const createStubPrisma = (): StubPrisma => {
  const calls = { connect: 0, disconnect: 0 };
  const client = {
    $connect: async (): Promise<void> => {
      calls.connect += 1;
    },
    $disconnect: async (): Promise<void> => {
      calls.disconnect += 1;
    },
    // injectPrismaClient wraps the client with a Prisma $extends query extension.
    $extends: (): unknown => client,
  } as unknown as PrismaClient;
  return { client, calls };
};

const unitHarness = () =>
  defineHarness({
    id: 'unit-harness',
    description: 'Harness used by the unit tests',
    chatProvider: 'unit-chat',
    embeddingProvider: 'unit-embed',
    defaultChatBaseURL: 'https://chat.example/v1',
    defaultEmbeddingBaseURL: 'https://embed.example/v1',
    chatAdapters: {
      'unit-chat': ({ config }) => fakeChatModel(`${config.type}:${config.model}`),
    },
    embeddingAdapters: {
      'unit-embed': () => fakeEmbeddings('embedding'),
      'unit-embed-alt': () => fakeEmbeddings('embedding-alt'),
    },
  });

const unitConfig = (overrides: {
  sliceBaseURL?: string;
  embeddingProvider?: string;
  includeEmbedding?: boolean;
  apiKey?: string;
  databaseUrl?: string;
}) => {
  const apiKey = overrides.apiKey ?? 'sk-unit-test-secret-123456';
  const slice = {
    model: 'unit-chat-model',
    apiKey,
    ...(overrides.sliceBaseURL === undefined ? {} : { baseURL: overrides.sliceBaseURL }),
  };

  return {
    harness: 'unit-harness',
    database: overrides.databaseUrl === undefined ? {} : { url: overrides.databaseUrl },
    models: {
      slice,
      judge: { model: 'unit-judge-model', apiKey },
      ...(overrides.includeEmbedding === false
        ? {}
        : {
            embedding: {
              model: 'unit-embedding-model',
              apiKey,
              ...(overrides.embeddingProvider === undefined
                ? {}
                : { provider: overrides.embeddingProvider }),
            },
          }),
    },
  };
};

const deepseekConfig = () => ({
  harness: 'deepseek',
  database: {},
  models: {
    slice: { model: 'deepseek-chat', apiKey: 'sk-deepseek-slice' },
    judge: { model: 'deepseek-chat', apiKey: 'sk-deepseek-judge' },
  },
});

beforeEach(() => {
  resetHarnesses();
  resetAdapters();
});

afterEach(() => {
  resetHarnesses();
  resetAdapters();
});

describe('maskDatabaseUrl', () => {
  it('masks the password and secret-looking query parameters, keeping the rest', () => {
    const masked = maskDatabaseUrl(
      'postgresql://user:topsecret@db:5432/x?password=abc&sslmode=require',
    );

    expect(masked).not.toContain('topsecret');
    expect(masked).not.toContain('abc');
    expect(masked).toContain('user');
    expect(masked).toContain('db:5432');
    expect(masked).toContain('sslmode=require');
  });

  it('falls back to maskSecret instead of throwing on unparseable input', () => {
    expect(maskDatabaseUrl('not a url')).toBe('***');
    expect(maskDatabaseUrl('short')).toBe('***');
  });
});

describe('planHarness', () => {
  it('plans models and a masked summary without touching the database', async () => {
    registerHarness(unitHarness());
    const apiKey = 'sk-pl...cdef';

    const plan = await planHarness({
      config: validateHarnessConfig({
        ...unitConfig({ apiKey }),
        database: {
          url: 'postgresql://user:topsecret@db:5432/x?password=abc&sslmode=require',
        },
      }),
    });

    expect(plan.definition.id).toBe('unit-harness');
    expect(plan.configs.map((config) => String(config.type))).toEqual(['slice', 'judge', 'embedding']);

    const serialized = JSON.stringify(plan.summary);
    expect(serialized).not.toContain('topsecret');
    expect(serialized).not.toContain('abc');
    expect(serialized).not.toContain(apiKey);
    expect(plan.summary.database.url).toContain('user');
    expect(plan.summary.database.url).toContain('sslmode=require');
  });

  it('does not require a database to plan', async () => {
    registerHarness(unitHarness());

    const plan = await planHarness({ config: validateHarnessConfig(unitConfig({})) });

    expect(plan.summary.database.url).toBeNull();
    expect(plan.configs).toHaveLength(3);
  });

  it('does not register harness adapters', async () => {
    registerHarness(unitHarness());

    await planHarness({ config: validateHarnessConfig(unitConfig({})) });

    expect(() => resolveChatAdapter('unit-chat')).toThrow(/is not registered/);
  });
});

describe('applyHarness', () => {
  it('maps provider defaults, applies default base URLs and fills the model loader', async () => {
    registerHarness(unitHarness());
    const stub = createStubPrisma();

    const applied = await applyHarness({
      config: validateHarnessConfig(unitConfig({})),
      database: { client: stub.client },
    });

    expect(stub.calls.connect).toBe(1);
    expect(applied.harness.id).toBe('unit-harness');
    expect(applied.prisma).toBe(stub.client);
    expect(getLoadedModels()).toBe(applied.models);
    expect(applied.models.slice).toBeDefined();
    expect(applied.models.judge).toBeDefined();
    expect(applied.models.embedding).toBeDefined();

    const byType = new Map(applied.summary.models.map((model) => [model.type, model]));
    expect(byType.get('slice')?.provider).toBe('unit-chat');
    expect(byType.get('judge')?.provider).toBe('unit-chat');
    expect(byType.get('embedding')?.provider).toBe('unit-embed');
    expect(byType.get('slice')?.baseURL).toBe('https://chat.example/v1');
    expect(byType.get('judge')?.baseURL).toBe('https://chat.example/v1');
    expect(byType.get('embedding')?.baseURL).toBe('https://embed.example/v1');
    expect(byType.get('slice')?.model).toBe('unit-chat-model');
    expect(byType.get('embedding')?.model).toBe('unit-embedding-model');

    await applied.close();
  });

  it('prefers explicit provider and baseURL over harness defaults', async () => {
    registerHarness(unitHarness());
    const stub = createStubPrisma();

    const applied = await applyHarness({
      config: validateHarnessConfig(
        unitConfig({
          sliceBaseURL: 'https://custom-chat.example/v2',
          embeddingProvider: 'unit-embed-alt',
        }),
      ),
      database: { client: stub.client },
    });

    const byType = new Map(applied.summary.models.map((model) => [model.type, model]));
    expect(byType.get('slice')?.baseURL).toBe('https://custom-chat.example/v2');
    expect(byType.get('judge')?.baseURL).toBe('https://chat.example/v1');
    expect(byType.get('embedding')?.provider).toBe('unit-embed-alt');

    await applied.close();
  });

  it('does not register harness adapters when registerAdapters is false', async () => {
    registerHarness(unitHarness());
    const stub = createStubPrisma();

    const error = await applyHarness({
      config: validateHarnessConfig(unitConfig({})),
      database: { client: stub.client },
      registerAdapters: false,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/adapter for provider 'unit-chat' is not registered/);
  });

  it('masks api keys in the summary', async () => {
    registerHarness(unitHarness());
    const stub = createStubPrisma();
    const apiKey = 'sk-unit-test-secret-123456';

    const applied = await applyHarness({
      config: validateHarnessConfig(unitConfig({ apiKey })),
      database: { client: stub.client },
    });

    const serialized = JSON.stringify(applied.summary);
    expect(serialized).not.toContain(apiKey);
    expect(applied.summary.models.map((model) => model.apiKey)).toEqual([
      maskSecret(apiKey),
      maskSecret(apiKey),
      maskSecret(apiKey),
    ]);
    expect(serialized).toContain(maskSecret(apiKey));

    await applied.close();
  });

  it('never disconnects an injected client and stays idempotent', async () => {
    registerHarness(unitHarness());
    const stub = createStubPrisma();

    const applied = await applyHarness({
      config: validateHarnessConfig(unitConfig({})),
      database: { client: stub.client },
    });

    expect(applied.prisma).toBe(stub.client);
    await applied.close();
    await applied.close();

    expect(stub.calls.disconnect).toBe(0);
  });

  it('disconnects the client it created itself, once', async () => {
    registerHarness(unitHarness());

    // Avoid a real connection: the ownership rule is what is under test here.
    const hooks = PrismaClient.prototype as unknown as {
      $connect: () => Promise<void>;
      $disconnect: () => Promise<void>;
    };
    const originalConnect = hooks.$connect;
    const originalDisconnect = hooks.$disconnect;
    let connects = 0;
    let disconnects = 0;
    hooks.$connect = async (): Promise<void> => {
      connects += 1;
    };
    hooks.$disconnect = async (): Promise<void> => {
      disconnects += 1;
    };

    try {
      const applied = await applyHarness({
        config: validateHarnessConfig(unitConfig({
          databaseUrl: 'postgresql://unit:unit@localhost:5432/unit',
        })),
      });

      expect(connects).toBe(1);
      await applied.close();
      await applied.close();
      expect(disconnects).toBe(1);
    } finally {
      hooks.$connect = originalConnect;
      hooks.$disconnect = originalDisconnect;
    }
  });

  it('disconnects an owned client when model injection fails', async () => {
    registerHarness(unitHarness());
    const previousPrisma = getPrismaClient();

    const hooks = PrismaClient.prototype as unknown as {
      $connect: () => Promise<void>;
      $disconnect: () => Promise<void>;
    };
    const originalConnect = hooks.$connect;
    const originalDisconnect = hooks.$disconnect;
    let connects = 0;
    let disconnects = 0;
    hooks.$connect = async (): Promise<void> => {
      connects += 1;
    };
    hooks.$disconnect = async (): Promise<void> => {
      disconnects += 1;
    };

    try {
      await expect(
        applyHarness({
          config: validateHarnessConfig(
            unitConfig({
              databaseUrl: 'postgresql://unit:unit@localhost:5432/unit',
              embeddingProvider: 'missing-provider',
            }),
          ),
        }),
      ).rejects.toThrow("adapter for provider 'missing-provider' is not registered");

      expect(connects).toBe(1);
      expect(disconnects).toBe(1);
      expect(getPrismaClient()).toBe(previousPrisma);
    } finally {
      hooks.$connect = originalConnect;
      hooks.$disconnect = originalDisconnect;
    }
  });

  it('does not disconnect an injected client when model injection fails', async () => {
    registerHarness(unitHarness());
    const stub = createStubPrisma();

    await expect(
      applyHarness({
        config: validateHarnessConfig(unitConfig({ embeddingProvider: 'missing-provider' })),
        database: { client: stub.client },
      }),
    ).rejects.toThrow("adapter for provider 'missing-provider' is not registered");

    expect(stub.calls.connect).toBe(1);
    expect(stub.calls.disconnect).toBe(0);
  });

  it('reports the DeepSeek embedding requirement with the exact message', async () => {
    const stub = createStubPrisma();

    let error: unknown;
    try {
      await applyHarness({
        config: validateHarnessConfig(deepseekConfig()),
        database: { client: stub.client },
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(DEEPSEEK_EMBEDDING_MESSAGE);
    expect(stub.calls.connect).toBe(0);
  });

  it('requires database.url when no client is injected', async () => {
    registerHarness(unitHarness());

    const error = await applyHarness({
      config: validateHarnessConfig(unitConfig({})),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/database\.url/);
  });

  it('requires slice and judge slots', async () => {
    const stub = createStubPrisma();
    const config = validateHarnessConfig({
      harness: 'deepseek',
      database: {},
      models: { judge: { model: 'deepseek-chat', apiKey: 'sk-j' } },
    });

    await expect(applyHarness({ config, database: { client: stub.client } })).rejects.toThrow(
      /models\.slice/,
    );
  });
});
