import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'bun:test';
import { setup } from '../testSupport.ts';
import { GRAPHRAG_TS_VERSION, handleVersion, SERVICE_VERSION } from './version.ts';
import type { SnapshotRecord } from '../../integrity/types.ts';

const makeRequest = (pathname = '/version', method = 'GET'): Request =>
  new Request(`https://pay.ashesborn.cloud${pathname}`, { method });

describe('version route', () => {
  test('returns deployment facts with exactly the documented keys', async () => {
    const response = await handleVersion(makeRequest(), setup().deps);
    expect(response?.status).toBe(200);
    expect(response?.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response?.headers.get('cache-control')).toBe('no-store');
    const body = await response?.json() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      'generated_at', 'graphrag_ts_version', 'relationship', 'service', 'snapshot', 'snapshot_id', 'version',
    ]);
    expect(body).toMatchObject({
      service: 'graphrag-ts-mcp-server', version: SERVICE_VERSION, graphrag_ts_version: GRAPHRAG_TS_VERSION,
      relationship: 'subservice', snapshot_id: 'ri-20261125-1712',
      snapshot: { built_at: '2026-11-25T17:20:00.000Z', papers: 99123, retractions: 611, cites: 145002 },
    });
    expect(body.generated_at).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
    expect(GRAPHRAG_TS_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('returns null snapshot facts when there is no active snapshot', async () => {
    const deps = setup().deps;
    const response = await handleVersion(makeRequest(), {
      ...deps, integrity: { ...deps.integrity, activeSnapshot: async (): Promise<SnapshotRecord | undefined> => undefined },
    });
    expect(response?.status).toBe(200);
    const body = await response?.json() as Record<string, unknown>;
    expect(body.snapshot_id).toBeNull();
    expect(body.snapshot).toBeNull();
  });

  test('maps snapshot lookup failures to 503', async () => {
    const deps = setup().deps;
    const response = await handleVersion(makeRequest(), {
      ...deps, integrity: { ...deps.integrity, activeSnapshot: async () => { throw new Error('unavailable'); } },
    });
    expect(response?.status).toBe(503);
    expect(await response?.json()).toEqual({ error: 'Snapshot state unavailable.' });
  });

  test('supports HEAD and rejects unsupported methods', async () => {
    const deps = setup().deps;
    const head = await handleVersion(makeRequest('/version', 'HEAD'), deps);
    expect(head?.status).toBe(200);
    expect(head?.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(head?.headers.get('cache-control')).toBe('no-store');
    expect(await head?.text()).toBe('');
    expect((await handleVersion(makeRequest('/version', 'POST'), deps))?.status).toBe(405);
  });

  test('does not handle other paths', async () => {
    expect(await handleVersion(makeRequest('/other'), setup().deps)).toBeUndefined();
  });

  test('keeps the service version aligned with the root package', async () => {
    const packageText = await readFile(new URL('../../../../../package.json', import.meta.url), 'utf8');
    const packageData = JSON.parse(packageText) as { version: string };
    expect(SERVICE_VERSION).toBe(packageData.version);
  });
});
