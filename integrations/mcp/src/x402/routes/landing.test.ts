import { describe, expect, test } from 'bun:test';
import { handleLanding } from './landing.ts';

describe('landing and status routes', () => {
  test('redirects the root to status', () => {
    const response = handleLanding(new Request('https://pay.ashesborn.cloud/'));
    expect(response?.status).toBe(302);
    expect(response?.headers.get('location')).toBe('/status');
    expect(response?.headers.get('cache-control')).toBe('public, max-age=300');
  });

  test('serves the status page and required snapshot, source, and pricing copy', async () => {
    const response = handleLanding(new Request('https://pay.ashesborn.cloud/status'));
    expect(response?.status).toBe(200);
    expect(response?.headers.get('content-type')).toBe('text/html; charset=utf-8');
    const body = await response?.text();
    for (const literal of [
      'Snapshot (updated 2026-10-25)', 'Snapshot (updated 2026-10-25) · ri-20261025-1526',
      '98,868 papers', '572 retraction assertions', '144,814 citation edges',
      'OpenAlex and Retraction Watch', 'Crossref only when an update-to notice exists', 'Not in snapshot', '$0.02', '$0.10',
    ]) {
      expect(body).toContain(literal);
    }
  });

  test('rejects unsupported methods and does not handle other paths', () => {
    expect(handleLanding(new Request('https://pay.ashesborn.cloud/status', { method: 'POST' }))?.status).toBe(405);
    expect(handleLanding(new Request('https://pay.ashesborn.cloud/other'))).toBeUndefined();
  });
});
