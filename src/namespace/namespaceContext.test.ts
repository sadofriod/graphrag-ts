import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { getCurrentNamespace, withNamespace } from './namespaceContext';

const ENV_KEY = 'RAG_DEFAULT_NAMESPACE';

describe('namespaceContext', () => {
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

  it('resolves the default namespace outside any context', () => {
    expect(getCurrentNamespace()).toBe('default-namespace');
  });

  it('returns the active namespace inside a withNamespace block', async () => {
    await withNamespace('ns-a', () => {
      expect(getCurrentNamespace()).toBe('ns-a');
    });
  });

  it('restores the outer namespace after the block ends', async () => {
    await withNamespace('ns-a', () => {});
    expect(getCurrentNamespace()).toBe('default-namespace');
  });

  it('keeps the namespace for promises returned by non-async callbacks', async () => {
    const seen = await withNamespace('ns-a', () =>
      Promise.resolve().then(() => getCurrentNamespace()),
    );

    expect(seen).toBe('ns-a');
  });

  it('isolates concurrent async work by namespace', async () => {
    const results: string[] = [];
    await Promise.all([
      withNamespace('ns-a', async () => {
        await Bun.sleep(8);
        results.push(getCurrentNamespace());
      }),
      withNamespace('ns-b', async () => {
        await Bun.sleep(1);
        results.push(getCurrentNamespace());
      }),
    ]);

    expect(results.sort()).toEqual(['ns-a', 'ns-b']);
  });
});
