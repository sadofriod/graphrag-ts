import { describe, expect, test } from 'bun:test';
import { handleLanding } from './landing.ts';
import { setup } from '../testSupport.ts';

const testDeps = () => setup().deps;

describe('landing and status routes', () => {
  test('redirects the root to status', async () => {
    const response = await handleLanding(new Request('https://pay.ashesborn.cloud/'), testDeps());
    expect(response?.status).toBe(302);
    expect(response?.headers.get('location')).toBe('/status');
    expect(response?.headers.get('cache-control')).toBe('public, max-age=300');
  });

  test('serves the status page and required snapshot, source, and pricing copy', async () => {
    const response = await handleLanding(new Request('https://pay.ashesborn.cloud/status'), testDeps());
    expect(response?.status).toBe(200);
    expect(response?.headers.get('content-type')).toBe('text/html; charset=utf-8');
    const body = await response?.text();
    for (const literal of [
      'Snapshot (updated 2026-11-25)', 'Snapshot (updated 2026-11-25) · ri-20261125-1712',
      '99,123 papers', '611 retraction assertions', '145,002 citation edges',
      'OpenAlex and Retraction Watch', 'Crossref only when an update-to notice exists', 'Not in snapshot', '$0.02', '$0.10',
    ]) {
      expect(body).toContain(literal);
    }
  });

  test('renders degraded copy when the snapshot store throws', async () => {
    const deps = testDeps();
    const response = await handleLanding(new Request('https://pay.ashesborn.cloud/status'), {
      ...deps, integrity: { ...deps.integrity, activeSnapshot: async () => { throw new Error('unavailable'); } },
    });
    const body = await response?.text();
    expect(body).toContain('Snapshot unavailable · snapshot_id unknown');
    expect(body).toContain('— papers · — retraction assertions · — citation edges');
    expect(body).toContain('Snapshot unavailable. This lookup covers');
  });

  test('rejects unsupported methods and does not handle other paths', async () => {
    expect((await handleLanding(new Request('https://pay.ashesborn.cloud/status', { method: 'POST' }), testDeps()))?.status).toBe(405);
    expect(await handleLanding(new Request('https://pay.ashesborn.cloud/other'), testDeps())).toBeUndefined();
  });
});
