import { describe, expect, test } from 'bun:test';
import { runDependencyScan } from './scan.ts';
import type { OsvClient, OsvScanResult } from './osv.ts';

const result: OsvScanResult = {
  source: 'OSV', queried_at: '2026-01-01T00:00:00.000Z', items: [],
  summary: { requested: 1, checked: 1, affected_packages: 0, advisory_count: 0, not_found_packages: 0, unchecked_packages: 0 },
};

describe('runDependencyScan', () => {
  test('rejects empty requests and requests over the SKU limit', () => {
    const client = { scan: async () => result } as OsvClient;
    expect(() => runDependencyScan(client, [], 20)).toThrow();
    expect(() => runDependencyScan(client, Array.from({ length: 21 }, (_, index) => `pkg-${index}@1.0.0`), 20)).toThrow();
  });

  test('passes the package list and default ecosystem to the client and returns its result', async () => {
    const inputs = ['lodash@4.17.20'];
    let received: typeof inputs = [];
    let ecosystem = '';
    const client: OsvClient = { scan: async (packages, defaultEcosystem) => {
      received = packages as typeof inputs;
      ecosystem = defaultEcosystem ?? '';
      return result;
    } };
    expect(await runDependencyScan(client, inputs, 20, 'npm')).toBe(result);
    expect(received).toBe(inputs);
    expect(ecosystem).toBe('npm');
  });
});
