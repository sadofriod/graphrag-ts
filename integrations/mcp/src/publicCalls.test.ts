import { describe, expect, test } from 'bun:test';
import type { Pool } from 'pg';
import { createPublicCallStore, hashIp } from './publicCalls.ts';

type CapturedQuery = { readonly sql: string; readonly params?: readonly unknown[] };

const createFakePool = () => {
  const calls: CapturedQuery[] = [];
  const pool = {
    query: async (sql: string, params?: readonly unknown[]) => {
      calls.push({ sql, ...(params ? { params } : {}) });
      return { rows: [] };
    },
  } as unknown as Pick<Pool, 'query'>;
  return { pool, calls };
};

describe('public call metrics', () => {
  test('hashIp is stable for the same IP, day, and salt', () => {
    expect(hashIp('203.0.113.1', '2026-10-01', 'test-salt'))
      .toBe(hashIp('203.0.113.1', '2026-10-01', 'test-salt'));
  });

  test('hashIp differs for a different day and salt', () => {
    const hash = hashIp('203.0.113.1', '2026-10-01', 'test-salt');
    expect(hashIp('203.0.113.1', '2026-10-02', 'test-salt')).not.toBe(hash);
    expect(hashIp('203.0.113.1', '2026-10-01', 'another-salt')).not.toBe(hash);
  });

  test('recordPublicCall issues an INSERT with the provided call details', async () => {
    const { pool, calls } = createFakePool();
    const store = createPublicCallStore(pool);

    await store.recordPublicCall({ ipHash: 'hash', tool: 'query_graph', outcome: 'ok', latencyMs: 42 });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain('INSERT INTO public_calls');
    expect(calls[0]?.params).toEqual(['hash', 'query_graph', 'ok', 42]);
  });

  test('recordPublicCall clamps negative latency to zero', async () => {
    const { pool, calls } = createFakePool();
    const store = createPublicCallStore(pool);

    await store.recordPublicCall({ ipHash: 'hash', tool: 'query_graph', outcome: 'error', latencyMs: -4 });

    expect(calls[0]?.params).toEqual(['hash', 'query_graph', 'error', 0]);
  });

  test('prunePublicCalls deletes old public call records', async () => {
    const { pool, calls } = createFakePool();
    const store = createPublicCallStore(pool);

    await store.prunePublicCalls();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain('DELETE FROM public_calls');
  });
});
