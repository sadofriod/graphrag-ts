import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { resolveNamespace } from './resolveNamespace';

const ENV_KEY = 'RAG_DEFAULT_NAMESPACE';

describe('resolveNamespace', () => {
  const originalEnv = Bun.env[ENV_KEY];

  beforeEach(() => {
    Bun.env[ENV_KEY] = '';
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete Bun.env[ENV_KEY];
    } else {
      Bun.env[ENV_KEY] = originalEnv;
    }
  });

  it('falls back to the hardcoded default when header and env are absent', () => {
    expect(resolveNamespace()).toBe('default-namespace');
    expect(resolveNamespace(null)).toBe('default-namespace');
  });

  it('uses a valid header', () => {
    expect(resolveNamespace('my-workspace')).toBe('my-workspace');
  });

  it('normalizes the header before using it', () => {
    expect(resolveNamespace('  My-Workspace ')).toBe('my-workspace');
  });

  it('prefers a valid header over the env default', () => {
    Bun.env[ENV_KEY] = 'env-default';
    expect(resolveNamespace('header-ns')).toBe('header-ns');
  });

  it('falls back to the env default when the header is absent', () => {
    Bun.env[ENV_KEY] = 'env-default';
    expect(resolveNamespace()).toBe('env-default');
  });

  it('falls back to the env default when the header is invalid', () => {
    Bun.env[ENV_KEY] = 'env-default';
    expect(resolveNamespace('bad ns!')).toBe('env-default');
  });

  it('normalizes the env default', () => {
    Bun.env[ENV_KEY] = '  Env-Default ';
    expect(resolveNamespace()).toBe('env-default');
  });

  it('falls back to the hardcoded default when the env value is invalid', () => {
    Bun.env[ENV_KEY] = 'not a slug!';
    expect(resolveNamespace()).toBe('default-namespace');
  });
});
