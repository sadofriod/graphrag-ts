import { describe, expect, test } from 'bun:test';
import { handleLlmsTxt } from './llms.ts';

const expected = `# Ashes Born retraction API

> Check whether a paper is retracted. Free DOI lookup against a fixed snapshot, paid evidence checks over x402 (USDC on Base or Arbitrum).

## Snapshot

- Snapshot (updated 2026-10-25): ri-20261025-1526. 98,868 papers, 144,814 citation edges, 572 per-source retraction assertions. This is a snapshot, not a live query.
- Sources: OpenAlex and Retraction Watch; Crossref only when an update-to notice exists.

## Free

- GET https://pay.ashesborn.cloud/api/v1/judge/paper?doi={DOI}: what OpenAlex and Retraction Watch assert, and Crossref only when an update-to notice exists, with tier and date. A DOI that is not in the snapshot returns paper: null with abstention_reason "paper_not_in_snapshot", never "not retracted". No source row is returned as no source row. No key.
- Alias: GET https://pay.ashesborn.cloud/paper?doi={DOI} returns the same document.

## Paid (x402)

- POST https://pay.ashesborn.cloud/api/v1/judge: retraction evidence check — every source row with tier and date, plus propagation. $0.02 single, $0.10 full audit.

## Docs

- OpenAPI: https://pay.ashesborn.cloud/api/v1/openapi.json
- Pricing: https://pay.ashesborn.cloud/api/v1/pricing
- Telemetry: https://pay.ashesborn.cloud/api/v1/telemetry
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
