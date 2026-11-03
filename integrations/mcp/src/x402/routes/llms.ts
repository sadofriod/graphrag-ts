import { errorResponse } from '../http.ts';

const llmsTxt = `# Ashes Born retraction API

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

export const handleLlmsTxt = (request: Request): Response | undefined => {
  if (new URL(request.url).pathname !== '/llms.txt') return undefined;
  if (request.method !== 'GET') return errorResponse(405, 'Method not allowed.');
  return new Response(llmsTxt, { status: 200, headers: {
    'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=300',
  } });
};
