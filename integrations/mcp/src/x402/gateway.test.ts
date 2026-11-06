import { createHash } from 'node:crypto';
import { requestHash } from './payload.ts';
import { handleOpenApi } from './routes/openapi.ts';
import { handleLlmsTxt } from './routes/llms.ts';
import { decodePaymentHeader, type PaymentPayload, type PaymentRequirements } from './types.ts';
import { describe, expect, settings, setup, test } from './testSupport.ts';

describe('x402 paid query gateway', () => {
  test('serves a public OpenAPI document and structured validation errors for judgment requests', async () => {
    const openApi = handleOpenApi(new Request('https://public.test/api/v1/openapi.json'));
    expect(openApi?.status).toBe(200);
    expect(openApi?.headers.get('content-type')).toContain('application/json');
    expect(openApi?.headers.get('cache-control')).toBe('public, max-age=60');
    const document = await openApi?.json() as { openapi: string; servers: unknown[]; paths: Record<string, unknown> };
    expect(document.openapi).toBe('3.1.0');
    expect(document.servers).toEqual([{ url: 'https://pay.ashesborn.cloud', description: 'production' }]);
    expect(document.paths).toHaveProperty('/api/v1/judge');
    expect(document.paths).toHaveProperty('/api/v1/judge/batch-10');
    expect(document.paths).toHaveProperty('/api/v1/judge/batch-50');
    expect(document.paths).toHaveProperty('/api/v1/judge/paper');
    expect(document.paths).toHaveProperty('/api/v1/deps/scan-20');
    expect(document.paths).toHaveProperty('/api/v1/deps/scan-100');
    expect(document.paths).toHaveProperty('/api/v1/deps/check');
    expect(document.paths).toHaveProperty('/api/v1/query');
    expect(JSON.stringify(document.paths['/api/v1/judge'])).toContain('x-price-usdc');
    const judgePath = document.paths['/api/v1/judge'] as { post: { 'x-price-usdc': Record<string, string> } };
    expect(judgePath.post['x-price-usdc']).toEqual({ 'retraction-propagation': '0.02', 'retraction-evidence-audit': '0.10' });
    for (const [path, price] of [['/api/v1/judge/batch-10', '0.50'], ['/api/v1/judge/batch-50', '2.00']] as const) {
      const operation = document.paths[path] as { post: { 'x-price-usdc': string; requestBody: { content: { 'application/json': { schema: { properties: Record<string, unknown>; required: string[] }; example: Record<string, unknown> } } } } };
      expect(Object.keys(document.paths[path] as Record<string, unknown>)).toEqual(['post']);
      expect(operation.post['x-price-usdc']).toBe(price);
      const body = operation.post.requestBody.content['application/json'];
      expect(body.schema.required).toEqual(['references']);
      expect(body.schema.properties).toHaveProperty('references');
      expect(body.schema.properties).not.toHaveProperty('dataset_id');
      expect(body.example).toHaveProperty('references');
      expect(body.example).not.toHaveProperty('dataset_id');
    }
    expect(JSON.stringify(document.paths['/api/v1/query'])).toContain('x-networks');

    const app = setup({ includeJudgment: true });
    const routedOpenApi = await app.route(new Request('https://internal.test/api/v1/openapi.json'));
    expect(routedOpenApi?.status).toBe(200);
    expect((await routedOpenApi?.json() as { paths: Record<string, unknown> }).paths).toHaveProperty('/api/v1/judge');
    const invalid = await app.route(new Request('https://internal.test/api/v1/judge', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ doi: '10.1234/missing-dataset' }),
    }));
    expect(invalid?.status).toBe(402);
    expect(invalid?.headers.get('payment-required')).toBeTruthy();
    expect(await invalid?.json()).toEqual({ error: 'invalid_request_body' });
    expect(app.verifyCalls).toBe(0);
    expect(app.settleCalls).toBe(0);
    expect(app.records.size).toBe(0);
    for (const [headers, body, expectedError] of [
      [{ 'content-type': 'text/plain' }, '{"dataset_id":"demo","doi":"10.1234/example"}', 'Request body must be JSON.'],
      [{ 'content-type': 'application/json' }, 'x'.repeat(8193), 'Request body exceeds 8192 bytes.'],
    ] as const) {
      const response = await app.route(new Request('https://internal.test/api/v1/judge', {
        method: 'POST', headers, body,
      }));
      expect(response?.status).toBe(402);
      expect(response?.headers.get('payment-required')).toBeTruthy();
      expect(await response?.json()).toEqual({ error: expectedError });
    }
  });

  test('reports application time in server-timing on every paid response', async () => {
    const app = setup();
    // No PAYMENT-SIGNATURE: the challenge response is what carries the header a
    // buyer sees before paying.
    const challenge = await app.route(new Request('https://internal.test/api/v1/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dataset_id: 'demo', query: 'test' }),
    }));
    expect(challenge?.status).toBe(402);
    expect(challenge?.headers.get('server-timing')).toMatch(/^app;dur=\d+\.\d$/);
    const preflight = await app.route(new Request('https://internal.test/api/v1/query', { method: 'OPTIONS' }));
    expect(preflight?.status).toBe(204);
    expect(preflight?.headers.get('server-timing')).toMatch(/^app;dur=\d+\.\d$/);
  });

  test('returns a v2 payment challenge and free catalogue with CORS', async () => {
    const app = setup();
    const challenge = await app.route(new Request('https://internal.test/api/v1/query', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dataset_id: 'demo', query: 'test' }),
    }));
    expect(challenge?.status).toBe(402);
    expect(challenge?.headers.get('access-control-expose-headers')).toContain('PAYMENT-REQUIRED');
    const required = decodePaymentHeader(challenge?.headers.get('payment-required') ?? '') as {
      accepts: PaymentRequirements[]; extensions: { bazaar: unknown };
      resource: { url: string; serviceName?: string; tags?: string[] };
    };
    expect(required.accepts[0]).toMatchObject({ scheme: 'exact', amount: '20000' });
    expect(required.accepts[0]?.extra).not.toHaveProperty('facilitatorAddress');
    expect(required.accepts).toEqual([
      {
        scheme: 'exact', network: 'eip155:84532', amount: '20000', asset: '0xasset', payTo: '0xreceiver',
        maxTimeoutSeconds: 60, extra: { name: 'USDC', version: '2' },
      },
      {
        scheme: 'exact', network: 'eip155:42161', amount: '20000', asset: '0xasset', payTo: '0xreceiver',
        maxTimeoutSeconds: 60, extra: { name: 'USDC', version: '2' },
      },
    ]);
    const bazaar = required.extensions.bazaar as { info: { input: { type: string; method: string; bodyType: string; body: { dataset_id: string } }; output: { type: string } }; schema: { $ref?: string; required: string[] } };
    expect(bazaar.info.input).toMatchObject({ type: 'http', method: 'POST', bodyType: 'json', body: { dataset_id: 'demo' } });
    expect(bazaar.info.output.type).toBe('json');
    expect(bazaar.schema.$ref).toBeUndefined();
    expect(bazaar.schema.required).toContain('input');
    expect(required.resource.url).toBe('https://api.example.test/api/v1/query');
    expect(required.resource).toMatchObject({ serviceName: 'graphrag-ts' });
    expect(required.resource.tags).toHaveLength(1);
    for (const path of ['/api/v1/datasets', '/api/v1/pricing']) {
      const response = await app.route(new Request(`https://internal.test${path}`));
      expect(response?.status).toBe(200);
      expect((await response?.json()) as { datasets: unknown[] }).toHaveProperty('datasets');
    }
  });

  test('challenges an unpaid caller even when the body is missing or malformed', async () => {
    const app = setup();
    const bodies: Array<string | undefined> = [undefined, '', '{}', 'not json', JSON.stringify({ dataset_id: 'demo' })];
    for (const body of bodies) {
      const response = await app.route(new Request('https://internal.test/api/v1/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body }),
      }));
      expect(response?.status).toBe(402);
      const required = decodePaymentHeader(response?.headers.get('payment-required') ?? '') as {
        x402Version: number; accepts: PaymentRequirements | PaymentRequirements[];
      };
      expect(required.x402Version).toBe(2);
      const accepts = Array.isArray(required.accepts) ? required.accepts : [required.accepts];
      expect(accepts.length).toBeGreaterThan(0);
      expect(accepts[0]).toMatchObject({ scheme: 'exact', amount: '20000' });
    }
    expect(app.verifyCalls).toBe(0);
    expect(app.settleCalls).toBe(0);
  });

  test('rejects an invalid body once a payment signature is attached, without touching the facilitator', async () => {
    const app = setup();
    const response = await app.request({ dataset_id: 'demo' });
    expect(response?.status).toBe(400);
    expect(await response?.json()).toMatchObject({ error: 'Invalid request body.' });
    expect(app.verifyCalls).toBe(0);
    expect(app.settleCalls).toBe(0);
    expect(app.records.size).toBe(0);
  });

  test('routes only known paths, enforces route methods, and handles OPTIONS only below the API prefix', async () => {
    const app = setup();
    expect(await app.route(new Request('https://internal.test/not-found'))).toBeUndefined();
    const wrongQueryMethod = await app.route(new Request('https://internal.test/api/v1/query', { method: 'GET' }));
    expect(wrongQueryMethod?.status).toBe(405);

    const optionsApi = await app.route(new Request('https://internal.test/api/v1/unknown', { method: 'OPTIONS' }));
    expect(optionsApi?.status).toBe(204);
    const optionsOutsideApi = await app.route(new Request('https://internal.test/other', { method: 'OPTIONS' }));
    expect(optionsOutsideApi).toBeUndefined();

    expect((await app.route(new Request('https://internal.test/api/v1/datasets', { method: 'POST' })))?.status).toBe(405);
    expect((await app.route(new Request('https://internal.test/api/v1/judge/batch-10', { method: 'GET' })))?.status).toBe(405);
    expect((await app.route(new Request('https://internal.test/api/v1/judge/batch-50', { method: 'GET' })))?.status).toBe(405);
    expect((await app.route(new Request('https://internal.test/api/v1/pricing', { method: 'POST' })))?.status).toBe(405);
    expect((await app.route(new Request('https://internal.test/api/v1/discovery', { method: 'POST' })))?.status).toBe(405);
    expect((await app.route(new Request('https://internal.test/.well-known/x402', { method: 'POST' })))?.status).toBe(405);
  });

  test('includes the facilitator address in global upto requirements', async () => {
    const app = setup();
    const challenge = await app.route(new Request('https://internal.test/api/v1/query', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dataset_id: 'demo', query: 'test', mode: 'global' }),
    }));
    const required = decodePaymentHeader(challenge?.headers.get('payment-required') ?? '') as { accepts: PaymentRequirements[] };
    expect(required.accepts).toHaveLength(1);
    expect(required.accepts[0]?.network).toBe(settings.network);
    expect(required.accepts[0]?.extra).toMatchObject({
      paymentFlow: 'authorization', facilitatorAddress: settings.uptoFacilitatorAddress,
    });
  });

  test('serves cached resource-server and dataset discovery without payment', async () => {
    const app = setup();
    const manifest = await app.route(new Request('https://internal.test/.well-known/x402'));
    expect(manifest?.status).toBe(200);
    expect(manifest?.headers.get('cache-control')).toBe('public, max-age=300');
    expect(manifest?.headers.get('content-type')).toContain('application/json');
    expect(manifest?.headers.get('access-control-allow-origin')).toBe('*');
    expect(await manifest?.json()).toMatchObject({ kind: 'resource-server', resources: [
      { url: 'https://api.example.test/api/v1/query', method: 'POST' }, { url: 'https://api.example.test/api/v1/judge', method: 'POST' },
      { url: 'https://api.example.test/api/v1/judge/batch-10', method: 'POST' }, { url: 'https://api.example.test/api/v1/judge/batch-50', method: 'POST' },
      { url: 'https://api.example.test/api/v1/deps/scan-20', method: 'POST' }, { url: 'https://api.example.test/api/v1/deps/scan-100', method: 'POST' },
      { url: 'https://api.example.test/api/v1/judge/paper?doi={DOI}', method: 'GET', free: true },
      { url: 'https://api.example.test/api/v1/deps/check?name={NAME}&version={VERSION}&ecosystem={ECOSYSTEM}', method: 'GET', free: true },
    ] });
    const discovery = await app.route(new Request('https://internal.test/api/v1/discovery'));
    expect(discovery?.status).toBe(200);
    expect(await discovery?.json()).toMatchObject({
      x402Version: 2,
      items: [{ resource: 'https://api.example.test/api/v1/query', accepts: [
        {
          scheme: 'exact', network: 'eip155:84532', amount: '20000', asset: '0xasset', payTo: '0xreceiver',
          maxTimeoutSeconds: 60, extra: { name: 'USDC', version: '2' },
        },
        {
          scheme: 'exact', network: 'eip155:42161', amount: '20000', asset: '0xasset', payTo: '0xreceiver',
          maxTimeoutSeconds: 60, extra: { name: 'USDC', version: '2' },
        },
      ] }],
      pagination: { limit: 20, offset: 0, total: 1 },
    });
  });

  test('serves llms.txt verbatim and rejects other methods', async () => {
    const expected = `# Ashes Born retraction API

> Check whether a paper is retracted. Free DOI lookup against a fixed snapshot, paid evidence checks over x402 (USDC on Base or Arbitrum).

## Snapshot

- Snapshot (updated 2026-10-25): ri-20261025-1526. 98,868 papers, 144,814 citation edges, 572 per-source retraction assertions. This is a snapshot, not a live query.
- Sources: OpenAlex and Retraction Watch; Crossref only when an update-to notice exists.

## Free

- GET https://pay.ashesborn.cloud/api/v1/judge/paper?doi={DOI}: what OpenAlex and Retraction Watch assert, and Crossref only when an update-to notice exists, with tier and date. A DOI that is not in the snapshot returns paper: null with abstention_reason "paper_not_in_snapshot", never "not retracted". No source row is returned as no source row. No key.
- GET https://pay.ashesborn.cloud/api/v1/deps/check?name={NAME}&version={VERSION}: one package, same advisory fields, no key.
- Alias: GET https://pay.ashesborn.cloud/paper?doi={DOI} returns the same document.

## Paid (x402)

- POST https://pay.ashesborn.cloud/api/v1/judge: one paper, priced per SKU.
  - \`retraction-propagation\` — verdict, retracted roots, abstention. $0.02.
  - \`retraction-evidence-audit\` — full evidence path, tiers, conflict flags. $0.10.
- POST https://pay.ashesborn.cloud/api/v1/judge/batch-10: up to 10 references (DOI strings or citation lines) in one call, per-item results plus an unmatched list. $0.50. Body: {"references": [...]}.
- POST https://pay.ashesborn.cloud/api/v1/judge/batch-50: up to 50 references in one call. $2.00. Body: {"references": [...]}.
- POST https://pay.ashesborn.cloud/api/v1/deps/scan-20: up to 20 package@version entries, advisory IDs with severity and fixed versions. $0.02. Body: {"packages": ["lodash@4.17.20"]}.
- POST https://pay.ashesborn.cloud/api/v1/deps/scan-100: up to 100 entries. $0.10.

## Docs

- OpenAPI: https://pay.ashesborn.cloud/api/v1/openapi.json
- Pricing: https://pay.ashesborn.cloud/api/v1/pricing
- Telemetry: https://pay.ashesborn.cloud/api/v1/telemetry
- Datasets (CC0): https://ashesborn.cloud/datasets/

## Example curl

"https://pay.ashesborn.cloud/api/v1/judge/paper?doi=10.1016/S0140-6736(97)11096-0"
`;
    const response = handleLlmsTxt(new Request('https://pay.ashesborn.cloud/llms.txt'));
    expect(response?.status).toBe(200);
    expect(response?.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await response?.text()).toBe(expected);
    expect(handleLlmsTxt(new Request('https://pay.ashesborn.cloud/llms.txt', { method: 'POST' }))?.status).toBe(405);
  });

  test('advertises judgment products as paid judge resources', async () => {
    const app = setup({ includeJudgment: true });
    const catalogueResponse = await app.route(new Request('https://internal.test/api/v1/datasets'));
    const catalogue = await catalogueResponse?.json() as { datasets: { id: string; resource?: string }[] };
    expect(catalogue.datasets).toHaveLength(7);
    expect(Object.fromEntries(catalogue.datasets.map(({ id, resource }) => [id, resource]))).toEqual({
      demo: undefined,
      'retraction-propagation': 'https://api.example.test/api/v1/judge',
      'retraction-evidence-audit': 'https://api.example.test/api/v1/judge',
      'reference-audit-10': 'https://api.example.test/api/v1/judge/batch-10',
      'reference-audit-50': 'https://api.example.test/api/v1/judge/batch-50',
      'dependency-scan-20': 'https://api.example.test/api/v1/deps/scan-20',
      'dependency-scan-100': 'https://api.example.test/api/v1/deps/scan-100',
    });
    const response = await app.route(new Request('https://internal.test/api/v1/discovery'));
    const body = await response?.json() as { items: { id: string; resource: string; accepts: PaymentRequirements[] }[] };
    const judgmentItems = body.items.filter((item) => item.id !== 'demo');
    expect(judgmentItems).toHaveLength(6);
    expect(judgmentItems.map((item) => item.id).sort()).toEqual([
      'dependency-scan-100', 'dependency-scan-20', 'reference-audit-10', 'reference-audit-50', 'retraction-evidence-audit', 'retraction-propagation',
    ]);
    expect(judgmentItems.every((item) => item.accepts.length === 2)).toBe(true);
    expect(judgmentItems.map((item) => item.accepts[0]?.amount).sort()).toEqual(['100000', '100000', '20000', '20000', '2000000', '500000']);
    expect(Object.fromEntries(judgmentItems.map((item) => [item.id, item.resource]))).toEqual({
      'retraction-propagation': 'https://api.example.test/api/v1/judge',
      'retraction-evidence-audit': 'https://api.example.test/api/v1/judge',
      'reference-audit-10': 'https://api.example.test/api/v1/judge/batch-10',
      'reference-audit-50': 'https://api.example.test/api/v1/judge/batch-50',
      'dependency-scan-20': 'https://api.example.test/api/v1/deps/scan-20',
      'dependency-scan-100': 'https://api.example.test/api/v1/deps/scan-100',
    });
    expect(judgmentItems.map((item) => item.accepts)).toEqual([
      [
        {
          scheme: 'exact', network: 'eip155:84532', amount: '20000', asset: '0xasset', payTo: '0xreceiver',
          maxTimeoutSeconds: 60, extra: { name: 'USDC', version: '2' },
        },
        {
          scheme: 'exact', network: 'eip155:42161', amount: '20000', asset: '0xasset', payTo: '0xreceiver',
          maxTimeoutSeconds: 60, extra: { name: 'USDC', version: '2' },
        },
      ],
      [
        {
          scheme: 'exact', network: 'eip155:84532', amount: '100000', asset: '0xasset', payTo: '0xreceiver',
          maxTimeoutSeconds: 60, extra: { name: 'USDC', version: '2' },
        },
        {
          scheme: 'exact', network: 'eip155:42161', amount: '100000', asset: '0xasset', payTo: '0xreceiver',
          maxTimeoutSeconds: 60, extra: { name: 'USDC', version: '2' },
        },
      ],
      [
        {
          scheme: 'exact', network: 'eip155:84532', amount: '500000', asset: '0xasset', payTo: '0xreceiver',
          maxTimeoutSeconds: 60, extra: { name: 'USDC', version: '2' },
        },
        {
          scheme: 'exact', network: 'eip155:42161', amount: '500000', asset: '0xasset', payTo: '0xreceiver',
          maxTimeoutSeconds: 60, extra: { name: 'USDC', version: '2' },
        },
      ],
      [
        {
          scheme: 'exact', network: 'eip155:84532', amount: '2000000', asset: '0xasset', payTo: '0xreceiver',
          maxTimeoutSeconds: 60, extra: { name: 'USDC', version: '2' },
        },
        {
          scheme: 'exact', network: 'eip155:42161', amount: '2000000', asset: '0xasset', payTo: '0xreceiver',
          maxTimeoutSeconds: 60, extra: { name: 'USDC', version: '2' },
        },
      ],
      [
        {
          scheme: 'exact', network: 'eip155:84532', amount: '20000', asset: '0xasset', payTo: '0xreceiver',
          maxTimeoutSeconds: 60, extra: { name: 'USDC', version: '2' },
        },
        {
          scheme: 'exact', network: 'eip155:42161', amount: '20000', asset: '0xasset', payTo: '0xreceiver',
          maxTimeoutSeconds: 60, extra: { name: 'USDC', version: '2' },
        },
      ],
      [
        {
          scheme: 'exact', network: 'eip155:84532', amount: '100000', asset: '0xasset', payTo: '0xreceiver',
          maxTimeoutSeconds: 60, extra: { name: 'USDC', version: '2' },
        },
        {
          scheme: 'exact', network: 'eip155:42161', amount: '100000', asset: '0xasset', payTo: '0xreceiver',
          maxTimeoutSeconds: 60, extra: { name: 'USDC', version: '2' },
        },
      ],
    ]);
  });

  test('fixed batch paths challenge at their own resource and accept requests without dataset_id', async () => {
    const app = setup({ includeJudgment: true });
    for (const [path, datasetId, amount] of [
      ['/api/v1/judge/batch-10', 'reference-audit-10', '500000'],
      ['/api/v1/judge/batch-50', 'reference-audit-50', '2000000'],
    ] as const) {
      const challenge = await app.route(new Request(`https://internal.test${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ references: ['10.1234/example'] }),
      }));
      expect(challenge?.status).toBe(402);
      const paymentRequired = decodePaymentHeader(challenge?.headers.get('payment-required') ?? '') as {
        accepts: PaymentRequirements[]; resource: { url: string }; extensions: { bazaar: { info: { input: { body: Record<string, unknown> } }; schema: { properties: { input: { properties: { body: { required: string[] } } } } } } };
      };
      expect(paymentRequired.resource.url).toBe(`https://api.example.test${path}`);
      expect(paymentRequired.accepts).toEqual([
        expect.objectContaining({ network: 'eip155:84532', amount }),
        expect.objectContaining({ network: 'eip155:42161', amount }),
      ]);
      expect(paymentRequired.extensions.bazaar.info.input.body).toEqual({ references: [
        '10.1016/S0140-6736(97)11096-0', 'Wakefield AJ, et al. Ileal-lymphoid-nodular hyperplasia... Lancet. 1998;351:637-41. doi:10.1016/S0140-6736(97)11096-0',
      ] });
      expect(paymentRequired.extensions.bazaar.schema.properties.input.properties.body.required).toEqual(['references']);
      expect((await app.route(new Request(`https://internal.test${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ references: ['10.1234/example'], dataset_id: datasetId }),
      })))?.status).toBe(402);
    }
    const tooMany50 = await app.route(new Request('https://internal.test/api/v1/judge/batch-50', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ references: Array.from({ length: 51 }, (_, index) => `doi ${index}`) }),
    }));
    expect(tooMany50?.status).toBe(400);
    expect(await tooMany50?.json()).toEqual({ error: 'too_many_references', limit: 50 });
    const tooMany10 = await app.route(new Request('https://internal.test/api/v1/judge/batch-10', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ references: Array.from({ length: 11 }, (_, index) => `doi ${index}`) }),
    }));
    expect(tooMany10?.status).toBe(400);
    expect(await tooMany10?.json()).toEqual({ error: 'too_many_references', limit: 10 });
    const mismatch = await app.route(new Request('https://internal.test/api/v1/judge/batch-10', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dataset_id: 'reference-audit-50', references: ['10.1234/example'] }),
    }));
    expect(mismatch?.status).toBe(400);
    expect(await mismatch?.json()).toEqual({ error: 'dataset_id_mismatch', expected: 'reference-audit-10' });
    const malformed = await app.route(new Request('https://internal.test/api/v1/judge/batch-10', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not json',
    }));
    expect(malformed?.status).toBe(402);
    expect(await malformed?.json()).toEqual({ error: 'invalid_request_body' });
  });

  test('serves the free paper existence endpoint and validates its required identifier', async () => {
    const app = setup({ includeJudgment: true });
    const found = await app.route(new Request('https://internal.test/api/v1/judge/paper?doi=10.1234/example'));
    expect(found?.status).toBe(200);
    expect(await found?.json()).toMatchObject({ paper: { paper_id: 'W123' } });
    expect((await app.route(new Request('https://internal.test/api/v1/judge/paper')))?.status).toBe(400);
  });

  test('challenges dependency scan SKUs at their own URLs and prices, validates limits, then returns fake scan results after payment', async () => {
    const scanResult = {
      source: 'OSV', queried_at: '2026-01-01T00:00:00.000Z', query_ms: 0, partial: false,
      items: [{ input: 'lodash@4.17.20', name: 'lodash', version: '4.17.20', ecosystem: 'npm', existence: 'confirmed', affected: true, note: null,
        advisories: [{ id: 'GHSA-test', aliases: ['CVE-2026-0001'], summary: 'Example advisory.', severity_label: 'high', fixed_versions: ['4.17.21'],
          published: null, modified: null, source_uri: 'https://osv.dev/vulnerability/GHSA-test', tier: 'A' }], abstention_reason: null }],
      summary: { requested: 1, checked: 1, affected_packages: 1, advisory_count: 1, not_found_packages: 0, unchecked_packages: 0, budget_exceeded_packages: 0 },
    };
    const app = setup({ includeJudgment: true, dependencyResult: scanResult });
    for (const [path, amount] of [['/api/v1/deps/scan-20', '20000'], ['/api/v1/deps/scan-100', '100000']] as const) {
      const challenge = await app.route(new Request(`https://internal.test${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ packages: ['lodash@4.17.20'] }),
      }));
      expect(challenge?.status).toBe(402);
      const required = decodePaymentHeader(challenge?.headers.get('payment-required') ?? '') as {
        accepts: PaymentRequirements[]; resource: { url: string };
      };
      expect(required.resource.url).toBe(`https://api.example.test${path}`);
      expect(required.accepts).toEqual([
        expect.objectContaining({ network: 'eip155:84532', amount }), expect.objectContaining({ network: 'eip155:42161', amount }),
      ]);
    }
    const empty = await app.route(new Request('https://internal.test/api/v1/deps/scan-20', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ packages: [] }),
    }));
    expect(empty?.status).toBe(400);
    expect(await empty?.json()).toEqual({ error: 'packages_required' });
    const tooMany = await app.route(new Request('https://internal.test/api/v1/deps/scan-20', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ packages: Array.from({ length: 21 }, (_, index) => `pkg-${index}@1.0.0`) }),
    }));
    expect(tooMany?.status).toBe(400);
    expect(await tooMany?.json()).toEqual({ error: 'too_many_packages', limit: 20 });

    const paid = await app.route(new Request('https://internal.test/api/v1/deps/scan-20', {
      method: 'POST', headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': app.sign('local', 'dependency-scan-payment-01', { amount: '20000' }) },
      body: JSON.stringify({ packages: ['lodash@4.17.20'] }),
    }));
    expect(paid?.status).toBe(200);
    expect(await paid?.json()).toMatchObject({ dataset: { id: 'dependency-scan-20', tool: 'dependency_scan' }, judgment: scanResult, payment: { amount: '20000' } });
    expect(app.settleCalls).toBe(1);
  });

  test('serves free dependency lookup and validates required query parameters', async () => {
    const app = setup({ includeJudgment: true });
    const result = await app.route(new Request('https://internal.test/api/v1/deps/check?name=lodash&version=4.17.20&ecosystem=npm'));
    expect(result?.status).toBe(200);
    expect(await result?.json()).toMatchObject({ source: 'OSV', summary: { requested: 1, checked: 1 } });
    const missing = await app.route(new Request('https://internal.test/api/v1/deps/check?name=lodash'));
    expect(missing?.status).toBe(400);
  });

  test('returns advisory_source_unavailable when the free OSV source fails', async () => {
    const app = setup({ includeJudgment: true, dependencyFailure: true });
    const response = await app.route(new Request('https://internal.test/api/v1/deps/check?name=lodash&version=4.17.20'));
    expect(response?.status).toBe(503);
    expect(await response?.json()).toEqual({ error: 'advisory_source_unavailable' });
  });

  test('routes the /paper compatibility alias to the free paper status endpoint', async () => {
    const app = setup({ includeJudgment: true });
    const alias = await app.route(new Request('https://internal.test/paper?doi=10.1016%2FS0140-6736(97)11096-0'));
    const canonical = await app.route(new Request('https://internal.test/api/v1/judge/paper?doi=10.1016%2FS0140-6736(97)11096-0'));
    expect(alias?.status).toBe(200);
    expect(alias?.headers.get('x-compat-route')).toBe('/paper -> /api/v1/judge/paper');
    expect(await alias?.text()).toBe(await canonical?.text());
  });

  test('serves the x402 exchange over real HTTP headers', async () => {
    const app = setup();
    const server = Bun.serve({
      port: 0,
      fetch: async (request: Request) => (await app.route(request)) ?? new Response('not found', { status: 404 }),
    });
    try {
      const url = `http://127.0.0.1:${server.port}/api/v1/query`;
      const challenge = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dataset_id: 'demo', query: 'test' }),
      });
      expect(challenge.status).toBe(402);
      const required = decodePaymentHeader(challenge.headers.get('payment-required') ?? '') as {
        x402Version: number; accepts: PaymentRequirements[]; extensions: { bazaar: unknown };
      };
      expect(required).toMatchObject({ x402Version: 2, accepts: [
        {
          scheme: 'exact', network: 'eip155:84532', amount: '20000', asset: '0xasset', payTo: '0xreceiver',
          maxTimeoutSeconds: 60, extra: { name: 'USDC', version: '2' },
        },
        {
          scheme: 'exact', network: 'eip155:42161', amount: '20000', asset: '0xasset', payTo: '0xreceiver',
          maxTimeoutSeconds: 60, extra: { name: 'USDC', version: '2' },
        },
      ], extensions: { bazaar: expect.anything() } });
      const exposedHeaders = challenge.headers.get('access-control-expose-headers') ?? '';
      expect(exposedHeaders).toContain('PAYMENT-REQUIRED');
      expect(exposedHeaders).toContain('PAYMENT-RESPONSE');
      const paid = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': app.sign() },
        body: JSON.stringify({ dataset_id: 'demo', query: 'test' }),
      });
      expect(paid.status).toBe(200);
      expect(decodePaymentHeader(paid.headers.get('payment-response') ?? '')).toMatchObject({ success: true, transaction: '0xtx', amount: '20000' });
    } finally {
      server.stop(true);
    }
  });

  test('rejects invalid bodies, unknown datasets, malformed signatures and mismatched requirements', async () => {
    const app = setup();
    expect((await app.request({ dataset_id: 'demo', query: '', unexpected: true }))?.status).toBe(400);
    expect((await app.request({ dataset_id: 'unknown', query: 'test' }))?.status).toBe(404);
    expect((await app.request({ dataset_id: 'demo', query: 'test' }, 'invalid-base64'))?.status).toBe(400);
    expect((await app.request(undefined, app.sign('local', 'nonce-0001', { amount: '1' })))?.status).toBe(402);
  });

  test('does not execute or settle when facilitator verification fails', async () => {
    const app = setup({ valid: false });
    const signature = app.sign('local', 'nonce-invalid-1');
    const response = await app.request(undefined, signature, { 'Idempotency-Key': 'free-key-001' });
    expect(response?.status).toBe(402);
    expect(app.executions).toBe(0);
    expect(app.settleCalls).toBe(0);
    expect(app.records.size).toBe(0);
    expect(app.rejected).toHaveLength(1);
    expect(await response?.json()).toEqual({ error: 'invalid payment' });
    expect(response?.headers.get('payment-required')).toBeTruthy();
    app.valid = true;
    expect((await app.request(undefined, signature, { 'Idempotency-Key': 'free-key-001' }))?.status).toBe(200);
  });

  test('replays a settled request without charging again and rejects nonce reuse', async () => {
    const app = setup();
    const headers = { 'Idempotency-Key': 'stable-key-001' };
    const signature = app.sign('local', 'nonce-replay-1');
    const first = await app.request(undefined, signature, headers);
    const firstBody = await first?.text();
    const replay = await app.request(undefined, signature, headers);
    expect(replay?.status).toBe(200);
    expect(await replay?.text()).toBe(firstBody);
    expect(app.settleCalls).toBe(1);
    expect(app.executions).toBe(1);
    expect((await app.request({ dataset_id: 'demo', query: 'different' }, signature, { 'Idempotency-Key': 'different-key-01' }))?.status).toBe(409);
  });

  test('uses the signed payload fingerprint when no idempotency key is supplied', async () => {
    const app = setup();
    const signature = app.sign('local', 'nonce-fingerprint-request-id');
    expect((await app.request(undefined, signature))?.status).toBe(200);
    const [payment] = app.records.values();
    expect(payment?.requestId).toBe(`payment:${createHash('sha256').update(signature).digest('hex')}`);
  });

  test('replays the stored answer after the dataset quote changes', async () => {
    const app = setup();
    const signature = app.sign('local', 'nonce-price-change');
    const first = await app.request(undefined, signature);
    const body = await first?.text();
    app.changePrice();
    const replay = await app.request(undefined, signature);
    expect(replay?.status).toBe(200);
    expect(await replay?.text()).toBe(body);
    expect(app.verifyCalls).toBe(1);
    expect(app.settleCalls).toBe(1);
  });

  test('sweeping a stale authorized replay makes it failed instead of permanently in progress', async () => {
    const app = setup();
    const signature = app.sign('local', 'nonce-stale-authorized');
    const accepted = decodePaymentHeader(signature) as PaymentPayload;
    const begun = await app.payments.beginPayment({
      id: 'stale-id', requestId: 'stale-request', requestHash: requestHash({ dataset_id: 'demo', query: 'test', mode: 'local', max_results: 5 }), nonce: 'nonce-stale-authorized',
      datasetId: 'demo', workspaceId: 'workspace-demo', mode: 'local', scheme: 'exact', network: settings.network,
      asset: settings.asset, amountAuthorized: '20000', payloadFingerprint: createHash('sha256').update(signature).digest('hex'), payload: accepted,
      requirements: accepted.accepted, payer: '0xbuyer',
    });
    expect(begun.kind).toBe('new');
    if (begun.kind !== 'new') throw new Error('Expected a new stale payment record.');
    const outcome = await app.payments.resolveStale(begun.record.id);
    const [afterSweep] = app.records.values();
    expect(outcome).toBe('abandoned');
    expect(afterSweep).toMatchObject({ status: 'failed', errorReason: 'abandoned_before_settlement' });
    expect((await app.request(undefined, signature))?.status).toBe(402);
  });

  test('same body with a different signature cannot retrieve another buyer answer', async () => {
    const app = setup();
    const buyer = await app.request(undefined, app.sign('local', 'nonce-buyer-one'));
    expect(buyer?.status).toBe(200);
    app.valid = false;
    const collision = await app.request(undefined, app.sign('local', 'nonce-buyer-two'));
    expect(collision?.status).toBe(402);
    expect(await collision?.text()).not.toContain('local answer');
  });

  test('answers 503 on capacity exhaustion without verifying or reserving anything', async () => {
    const app = setup({ capacity: true });
    const response = await app.request();
    expect(response?.status).toBe(503);
    // A saturated server must not call the facilitator, and must not claim the idempotency key or nonce of a request it refuses.
    expect(app.verifyCalls).toBe(0);
    expect(app.settleCalls).toBe(0);
    expect(app.records.size).toBe(0);
  });
});
