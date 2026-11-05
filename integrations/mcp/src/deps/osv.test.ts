import { describe, expect, test } from 'bun:test';
import { createOsvClient, OsvUnavailableError } from './osv.ts';

const response = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('OSV dependency scan client', () => {
  test('parses unscoped and scoped package versions, retaining malformed items as abstentions', async () => {
    const requests: Array<{ url: string; body?: string }> = [];
    const client = createOsvClient({ now: () => 0, fetchImpl: async (url, init) => {
      requests.push({ url: String(url), ...(init?.body === undefined ? {} : { body: init.body as string }) });
      return String(url) === 'https://api.osv.dev/v1/query' ? response({ vulns: [] }) : response({});
    } });
    const result = await client.scan(['lodash@4.17.20', '@angular/core@17.0.0', 'lodash', { name: 'pkg' }]);
    expect(requests.filter(({ url }) => url === 'https://api.osv.dev/v1/query').map(({ body }) => JSON.parse(body!))).toEqual([
      { package: { name: 'lodash', ecosystem: 'npm' }, version: '4.17.20' },
      { package: { name: '@angular/core', ecosystem: 'npm' }, version: '17.0.0' },
    ]);
    expect(result.items.map(({ name, version, existence, abstention_reason, note }) => ({ name, version, existence, abstention_reason, note }))).toEqual([
      { name: 'lodash', version: '4.17.20', existence: 'confirmed', abstention_reason: null, note: 'No advisory recorded in OSV for this name and version. This is not a statement that the package is safe.' },
      { name: '@angular/core', version: '17.0.0', existence: 'confirmed', abstention_reason: null, note: 'No advisory recorded in OSV for this name and version. This is not a statement that the package is safe.' },
      { name: 'lodash', version: '', existence: 'unchecked', abstention_reason: 'package_not_found', note: null },
      { name: 'pkg', version: '', existence: 'unchecked', abstention_reason: 'package_not_found', note: null },
    ]);
    expect(result.summary).toMatchObject({ not_found_packages: 0, unchecked_packages: 2 });
  });

  test('maps database severity and CVSS scores, deduplicates fixed versions and returns unknown when severity is absent', async () => {
    const vulnerabilities = [
      { id: 'GHSA-a', database_specific: { severity: 'MODERATE' }, aliases: ['CVE-1'], affected: [{ ranges: [{ events: [{ fixed: '2.0.0' }, { fixed: '2.0.0' }] }] }] },
      { id: 'GHSA-b', severity: [{ type: 'CVSS_V3', score: '9.8' }] },
      { id: 'GHSA-c', database_specific: { severity: 'CRITICAL' } },
      { id: 'GHSA-d', database_specific: { severity: 'HIGH' } },
      { id: 'GHSA-e', database_specific: { severity: 'LOW' } },
      { id: 'GHSA-f' },
    ];
    const client = createOsvClient({ fetchImpl: async () => response({ vulns: vulnerabilities }) });
    const item = (await client.scan(['pkg@1.0.0'])).items[0]!;
    expect(item.advisories.map((advisory) => advisory.severity_label)).toEqual(['medium', 'critical', 'critical', 'high', 'low', 'unknown']);
    expect(item).toMatchObject({ existence: 'confirmed', note: null });
    expect(item.advisories[0]).toMatchObject({ aliases: ['CVE-1'], fixed_versions: ['2.0.0'], source_uri: 'https://osv.dev/vulnerability/GHSA-a', tier: 'A' });
  });

  test('maps CVSS numeric threshold labels', async () => {
    const scores = ['8.0', '6.0', '2.0'];
    const client = createOsvClient({ fetchImpl: async () => response({ vulns: scores.map((score, index) => ({ id: `GHSA-${index}`, severity: [{ type: 'CVSS_V3', score }] })) }) });
    expect((await client.scan(['pkg@1'])).items[0]?.advisories.map((item) => item.severity_label)).toEqual(['high', 'medium', 'low']);
  });

  test('queries each package separately and reuses duplicate advisory details in memory', async () => {
    const bodies: unknown[] = [];
    const client = createOsvClient({ fetchImpl: async (url, init) => {
      expect(String(url)).toBe('https://api.osv.dev/v1/query');
      bodies.push(JSON.parse(init?.body as string));
      return response({ vulns: [{ id: 'GHSA-shared', summary: 'Shared advisory', aliases: ['CVE-1'] }] });
    } });
    const result = await client.scan(['pkg-a@1', 'pkg-b@2']);
    expect(bodies).toEqual([
      { package: { name: 'pkg-a', ecosystem: 'npm' }, version: '1' },
      { package: { name: 'pkg-b', ecosystem: 'npm' }, version: '2' },
    ]);
    expect(result.items.map(({ existence, advisories }) => ({ existence, advisories }))).toEqual([
      { existence: 'confirmed', advisories: [{ id: 'GHSA-shared', aliases: ['CVE-1'], summary: 'Shared advisory', severity_label: 'unknown', fixed_versions: [], published: null, modified: null, source_uri: 'https://osv.dev/vulnerability/GHSA-shared', tier: 'A' }] },
      { existence: 'confirmed', advisories: [{ id: 'GHSA-shared', aliases: ['CVE-1'], summary: 'Shared advisory', severity_label: 'unknown', fixed_versions: [], published: null, modified: null, source_uri: 'https://osv.dev/vulnerability/GHSA-shared', tier: 'A' }] },
    ]);
  });

  test('marks a missing npm package not_found and confirms a PyPI package using fake registry responses', async () => {
    const requests: string[] = [];
    const client = createOsvClient({ fetchImpl: async (url) => {
      const target = String(url);
      requests.push(target);
      if (target === 'https://api.osv.dev/v1/query') return response({ vulns: [] });
      if (target === 'https://registry.npmjs.org/this-package-does-not-exist-xyz') return response({}, 404);
      if (target === 'https://pypi.org/pypi/requests/json') return response({ info: { name: 'requests' } });
      throw new Error(`Unexpected request: ${target}`);
    } });
    const result = await client.scan([
      { name: 'this-package-does-not-exist-xyz', version: '1.0.0', ecosystem: 'npm' },
      { name: 'requests', version: '2.31.0', ecosystem: 'PyPI' },
    ]);
    expect(requests).toContain('https://registry.npmjs.org/this-package-does-not-exist-xyz');
    expect(requests).toContain('https://pypi.org/pypi/requests/json');
    expect(result.items.map(({ existence, affected, note }) => ({ existence, affected, note }))).toEqual([
      { existence: 'not_found', affected: false, note: 'No advisory recorded in OSV for this name and version. This is not a statement that the package is safe.' },
      { existence: 'confirmed', affected: false, note: 'No advisory recorded in OSV for this name and version. This is not a statement that the package is safe.' },
    ]);
    expect(result.summary).toMatchObject({ not_found_packages: 1, unchecked_packages: 0 });
  });

  test('turns package existence lookup failures into unchecked without failing the scan', async () => {
    const client = createOsvClient({ fetchImpl: async (url) => String(url) === 'https://api.osv.dev/v1/query'
      ? response({ vulns: [] })
      : response({}, 503) });
    const result = await client.scan(['pkg@1']);
    expect(result.items[0]?.existence).toBe('unchecked');
    expect(result.summary.unchecked_packages).toBe(1);
  });

  test('returns a partial result and abstains for work still pending when the scan budget expires', async () => {
    const client = createOsvClient({ scanBudgetMs: 10, fetchImpl: async (url, init) => {
      const body = JSON.parse(init?.body as string) as { package: { name: string } };
      if (body.package.name === 'slow') return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
      expect(String(url)).toBe('https://api.osv.dev/v1/query');
      return response({ vulns: [{ id: 'GHSA-ready' }] });
    } });

    const result = await client.scan([
      { name: 'ready', version: '1.0.0', ecosystem: 'Maven' },
      { name: 'slow', version: '1.0.0', ecosystem: 'Maven' },
    ]);

    expect(result.partial).toBe(true);
    expect(result.query_ms).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(result.query_ms)).toBe(true);
    expect(result.items[0]).toMatchObject({ name: 'ready', affected: true, abstention_reason: null });
    expect(result.items[1]).toEqual({ input: 'slow@1.0.0', name: 'slow', version: '1.0.0', ecosystem: 'Maven',
      existence: 'unchecked', affected: false, advisories: [], note: null, abstention_reason: 'budget_exceeded' });
    expect(result.summary).toMatchObject({ requested: 2, checked: 1, budget_exceeded_packages: 1 });
  });

  test('uses the package cache without making OSV or registry requests on a cache hit', async () => {
    let requests = 0;
    const client = createOsvClient({ fetchImpl: async () => { requests += 1; return response({ vulns: [{ id: 'GHSA-cached' }] }); } });
    await client.scan(['cached-package@1.0.0']);
    const requestsAfterMiss = requests;
    const cached = await client.scan(['cached-package@1.0.0']);
    expect(requestsAfterMiss).toBeGreaterThan(0);
    expect(requests).toBe(requestsAfterMiss);
    expect(cached.partial).toBe(false);
  });

  test('throws OsvUnavailableError for HTTP failures', async () => {
    const client = createOsvClient({ fetchImpl: async () => response({}, 503) });
    await expect(client.scan(['lodash@4.17.20'])).rejects.toBeInstanceOf(OsvUnavailableError);
  });
});
