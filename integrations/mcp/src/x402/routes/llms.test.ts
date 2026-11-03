import { describe, expect, test } from 'bun:test';
import { handleLlmsTxt } from './llms.ts';

const expected = `# Ashes Born retraction API

> Check whether a paper is retracted. Free DOI lookup, paid evidenced judgments over x402 (USDC on Base or Arbitrum).

## Free

- GET https://pay.ashesborn.cloud/api/v1/judge/paper?doi={DOI}: what OpenAlex, Crossref and Retraction Watch each assert, with tier and date. No source row is returned as no source row, never as "not retracted". No key.

## Paid (x402)

- POST https://pay.ashesborn.cloud/api/v1/judge: evidenced retraction judgment. $0.02 single, $0.10 full audit.

## Docs

- OpenAPI: https://pay.ashesborn.cloud/api/v1/openapi.json
- Pricing: https://pay.ashesborn.cloud/api/v1/pricing
- Live telemetry: https://pay.ashesborn.cloud/api/v1/telemetry
- Datasets (CC0): https://ashesborn.cloud/datasets/

## Example curl

"https://pay.ashesborn.cloud/api/v1/judge/paper?doi=10.1016/S0140-6736(97)11096-0"
`;

describe('GET /llms.txt', () => {
  test('returns the exact plain-text resource document', async () => {
    const response = handleLlmsTxt(new Request('https://pay.ashesborn.cloud/llms.txt'));
    expect(response?.status).toBe(200);
    expect(response?.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(response?.headers.get('cache-control')).toBe('public, max-age=300');
    expect(await response?.text()).toBe(expected);
  });

  test('only handles its path and returns 405 for non-GET methods', () => {
    expect(handleLlmsTxt(new Request('https://pay.ashesborn.cloud/other'))).toBeUndefined();
    expect(handleLlmsTxt(new Request('https://pay.ashesborn.cloud/llms.txt', { method: 'POST' }))?.status).toBe(405);
  });
});
