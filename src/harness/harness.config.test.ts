import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  loadHarnessConfig,
  resolveEnvRefs,
  validateHarnessConfig,
} from './config';

describe('resolveEnvRefs', () => {
  it('resolves ${VAR} and ${VAR:-fallback} recursively', () => {
    const resolved = resolveEnvRefs(
      {
        plain: '${A}',
        fallback: '${MISSING:-fallback-value}',
        emptyUsesFallback: '${EMPTY:-from-fallback}',
        nested: { list: ['${A}-suffix', 7, true, null] },
      },
      { A: 'alpha', EMPTY: '' } as NodeJS.ProcessEnv,
    );

    expect(resolved).toEqual({
      plain: 'alpha',
      fallback: 'fallback-value',
      emptyUsesFallback: 'from-fallback',
      nested: { list: ['alpha-suffix', 7, true, null] },
    });
  });

  it('reports every missing variable by name and never prints resolved values', () => {
    const env = {
      SECRET_TOKEN: 'super-secret-value-should-not-leak',
      PRESENT: 'ok',
    } as NodeJS.ProcessEnv;

    let error: unknown;
    try {
      resolveEnvRefs(
        { apiKey: '${SECRET_TOKEN}', first: '${MISSING_ONE}', deep: { second: '${MISSING_TWO}' } },
        env,
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain('MISSING_ONE');
    expect(message).toContain('MISSING_TWO');
    expect(message).not.toContain('super-secret-value-should-not-leak');
    expect(message).not.toContain('${MISSING_ONE}');
  });
});

describe('validateHarnessConfig', () => {
  it('accepts a config without database.url and ignores unknown top-level keys', () => {
    const validated = validateHarnessConfig({
      harness: 'deepseek',
      database: {},
      models: { slice: { model: 'deepseek-chat', apiKey: 'sk-a' } },
      extraNote: 'ignored',
    });

    expect(validated.harness).toBe('deepseek');
    expect(validated.database).toEqual({});
    expect(validated.models.slice?.model).toBe('deepseek-chat');
    expect(validated).not.toHaveProperty('extraNote');
  });

  it('treats a missing database block as empty', () => {
    const validated = validateHarnessConfig({
      harness: 'deepseek',
      models: { slice: { model: 'deepseek-chat', apiKey: 'test-key' } },
    });

    expect(validated.database).toEqual({});
  });

  it('accepts configs containing only the supported model slots', () => {
    const validated = validateHarnessConfig({
      harness: 'deepseek',
      models: {
        slice: { model: 'slice-model', apiKey: 'slice-key' },
        judge: { model: 'judge-model', apiKey: 'judge-key' },
        embedding: { model: 'embedding-model', apiKey: 'embedding-key' },
      },
    });

    expect(validated.models).toEqual({
      slice: { model: 'slice-model', apiKey: 'slice-key' },
      judge: { model: 'judge-model', apiKey: 'judge-key' },
      embedding: { model: 'embedding-model', apiKey: 'embedding-key' },
    });
  });

  it('rejects unknown model slots', () => {
    expect(() =>
      validateHarnessConfig({
        harness: 'deepseek',
        models: {
          slice: { model: 'deepseek-chat', apiKey: 'test-key' },
          embed: { model: 'embedding-model', apiKey: 'test-key' },
        },
      }),
    ).toThrow("Unknown model slot 'models.embed'. Allowed slots: slice, judge, embedding.");
  });

  it('rejects a database block that is not an object', () => {
    expect(() =>
      validateHarnessConfig({
        harness: 'deepseek',
        database: 'x',
        models: { slice: { model: 'deepseek-chat', apiKey: 'test-key' } },
      }),
    ).toThrow(/database/);
  });

  it('accepts the shipped example config once env refs are resolved', async () => {
    const examplePath = join(
      import.meta.dir,
      '..',
      '..',
      'examples',
      'harness',
      'graphrag.harness.example.json',
    );
    const config = await loadHarnessConfig(examplePath, {
      DATABASE_URL: 'postgresql://user:secret@localhost:5432/graphrag',
      DEEPSEEK_API_KEY: 'test-key',
      EMBED_BASE_URL: 'https://embed.example/v1',
      EMBED_MODEL: 'text-embedding-3-small',
      EMBED_API_KEY: 'test-key',
    } as NodeJS.ProcessEnv);

    expect(config.harness).toBe('deepseek');
    expect(config.database.url).toBe('postgresql://user:secret@localhost:5432/graphrag');
    expect(config.models.embedding?.model).toBe('text-embedding-3-small');
  });

  it('rejects model specs with an empty model or apiKey', () => {
    expect(() =>
      validateHarnessConfig({
        harness: 'deepseek',
        database: {},
        models: { slice: { model: '', apiKey: 'sk-a' } },
      }),
    ).toThrow(/models\.slice\.model/);

    expect(() =>
      validateHarnessConfig({
        harness: 'deepseek',
        database: {},
        models: { slice: { model: 'deepseek-chat', apiKey: '' } },
      }),
    ).toThrow(/models\.slice\.apiKey/);
  });

  it('rejects a config without a harness id or models object', () => {
    expect(() => validateHarnessConfig({ database: {}, models: {} })).toThrow(/harness/);
    expect(() => validateHarnessConfig({ harness: 'deepseek', database: {} })).toThrow(/models/);
  });
});

describe('loadHarnessConfig', () => {
  it('reads JSON, interpolates env refs and validates it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'graphrag-harness-config-'));
    try {
      const configPath = join(dir, 'graphrag.json');
      await writeFile(
        configPath,
        JSON.stringify({
          harness: 'deepseek',
          database: { url: '${DB_URL:-postgresql://localhost:5432/graphrag}' },
          models: {
            slice: { model: '${SLICE_MODEL:-deepseek-chat}', apiKey: '${DEEPSEEK_API_KEY}' },
            embedding: {
              model: 'text-embedding-3-small',
              apiKey: '${EMBED_API_KEY}',
              baseURL: 'https://embed.example/v1',
            },
          },
        }),
        'utf8',
      );

      const config = await loadHarnessConfig(configPath, {
        DEEPSEEK_API_KEY: 'sk-deepseek-value',
        EMBED_API_KEY: 'sk-embed-value',
      } as NodeJS.ProcessEnv);

      expect(config.harness).toBe('deepseek');
      expect(config.database.url).toBe('postgresql://localhost:5432/graphrag');
      expect(config.models.slice).toEqual({ model: 'deepseek-chat', apiKey: 'sk-deepseek-value' });
      expect(config.models.embedding?.baseURL).toBe('https://embed.example/v1');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('names the file path when JSON is invalid', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'graphrag-harness-config-'));
    try {
      const configPath = join(dir, 'broken.json');
      await writeFile(configPath, '{ not json', 'utf8');

      const error = await loadHarnessConfig(configPath).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(configPath);
      expect((error as Error).message).toContain('JSON');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
