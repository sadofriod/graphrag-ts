import { describe, expect, test } from 'bun:test';
import { handleLlmsTxt } from './llms.ts';

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
