import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

import { maskSecret, resolveHarnessDefinition } from './config';
import { deepseekHarness } from './deepseek';
import { defineHarness } from './defineHarness';
import { getHarness, listHarnesses, registerHarness, resetHarnesses } from './registry';

const unitHarness = () =>
  defineHarness({
    id: 'unit-harness',
    description: 'Harness used by the unit tests',
    chatProvider: 'unit-chat',
    embeddingProvider: 'unit-embed',
    defaultChatBaseURL: 'https://chat.example/v1',
    defaultEmbeddingBaseURL: 'https://embed.example/v1',
    chatAdapters: { 'unit-chat': () => ({}) as unknown as BaseChatModel },
  });

beforeEach(() => {
  resetHarnesses();
});

afterEach(() => {
  resetHarnesses();
});

describe('harness registry', () => {
  it('registers the built-in deepseek harness', () => {
    expect(listHarnesses()).toEqual(['deepseek']);
    expect(getHarness('deepseek').chatProvider).toBe('deepseek');
    expect(getHarness('deepseek').requiresEmbedding).toBe(true);
  });

  it('lists available harnesses when the id is unknown', () => {
    registerHarness(unitHarness());

    let error: unknown;
    try {
      getHarness('nope');
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Unknown harness 'nope'. Available harnesses: deepseek, unit-harness",
    );
    expect(() => getHarness('nope')).toThrow(/Unknown harness 'nope'/);
  });

  it('keeps a re-registered deepseek until the registry is reset', () => {
    registerHarness({ ...deepseekHarness, description: 'overridden deepseek' });
    expect(getHarness('deepseek').description).toBe('overridden deepseek');

    resetHarnesses();
    expect(getHarness('deepseek').description).toBe(deepseekHarness.description);
    expect(listHarnesses()).toEqual(['deepseek']);
  });

  it('rejects invalid harness ids and empty descriptions', () => {
    expect(() =>
      defineHarness({ id: 'Bad Id', description: 'x', chatProvider: 'deepseek' }),
    ).toThrow(/Invalid harness id/);
    expect(() =>
      defineHarness({ id: 'valid-id', description: '   ', chatProvider: 'deepseek' }),
    ).toThrow(/description/);
    expect(() =>
      defineHarness({ id: 'valid-id', description: 'x', chatProvider: '' }),
    ).toThrow(/chatProvider/);
  });

  it('freezes registered definitions', () => {
    const definition = registerHarness(unitHarness());

    expect(Object.isFrozen(definition)).toBe(true);
    expect(Object.isFrozen(definition.chatAdapters)).toBe(true);
  });
});

describe('resolveHarnessDefinition', () => {
  it('loads a relative plugin module and registers it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'graphrag-harness-plugin-'));
    try {
      const defineHarnessModule = pathToFileURL(join(import.meta.dir, 'defineHarness.ts')).href;
      const pluginPath = join(dir, 'plugin.ts');
      await writeFile(
        pluginPath,
        [
          `import { defineHarness } from ${JSON.stringify(defineHarnessModule)};`,
          'export default defineHarness({',
          "  id: 'plugin-harness',",
          "  description: 'Loaded from a plugin file',",
          "  chatProvider: 'plugin-chat',",
          '});',
          '',
        ].join('\n'),
        'utf8',
      );

      const configPath = join(dir, 'graphrag.json');
      await writeFile(configPath, JSON.stringify({ harness: './plugin.ts' }), 'utf8');

      const definition = await resolveHarnessDefinition('./plugin.ts', configPath);

      expect(definition.id).toBe('plugin-harness');
      expect(definition.chatProvider).toBe('plugin-chat');
      expect(Object.isFrozen(definition)).toBe(true);
      expect(getHarness('plugin-harness').description).toBe('Loaded from a plugin file');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('throws the registry error for an unknown id', async () => {
    const error = await resolveHarnessDefinition('missing-harness').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Unknown harness 'missing-harness'. Available harnesses: deepseek",
    );
  });

  it('requires a config path to resolve relative plugin ids', async () => {
    const error = await resolveHarnessDefinition('./plugin.ts').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/config path/);
  });
});

describe('maskSecret', () => {
  it('keeps 3 leading and 4 trailing characters for long secrets', () => {
    expect(maskSecret('sk-1234567890abcd')).toBe('sk-\u2026abcd');
  });

  it('hides short secrets entirely', () => {
    expect(maskSecret('short-key')).toBe('***');
    expect(maskSecret('')).toBe('***');
  });
});
