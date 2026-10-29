# Agent discovery for the paid query API

> Client-side wire format for this flow (402 challenge, PAYMENT-SIGNATURE payload, EIP-3009 signing, error paths): <https://blog.ashesborn.cloud/blog/x402-integration-http-and-mcp>

An agent can only buy a resource it can find. This service publishes its paid endpoint three ways,
and only the first one is automatic:

| Channel | What it is | Who lists it |
| --- | --- | --- |
| Facilitator Bazaar | the `bazaar` extension on the 402 challenge | the facilitator, from settled/verified payments |
| `/.well-known/x402` | IETF draft capability manifest on this origin | any crawler/indexer that reads it |
| Directories (402 Index, x402scan) | third-party catalogues | their crawlers, or a one-off registration |

## Why PayAI is the default facilitator

`https://facilitator.payai.network`:

- needs **no account** to start (1,000 free credits) and no US business presence;
- supports `exact` on Base mainnet (`eip155:8453`) and Base Sepolia;
- implements the `bazaar` extension and exposes `/discovery/resources`, so a settled payment
  carrying the declaration gets the resource catalogued with no registration form;
- reports back what happened to the declaration in the `EXTENSION-RESPONSES` header.

It does **not** support the `upto` scheme. Set `"scheme": "exact"` on the dataset's `global`
pricing (or leave the default `upto` only when your facilitator supports it, e.g. a self-hosted or
CDP facilitator), otherwise global queries will advertise a scheme the facilitator cannot settle.

Verify with the facilitator itself:

```sh
curl -s https://facilitator.payai.network/supported | jq '.kinds[] | select(.network=="eip155:8453")'
curl -s 'https://facilitator.payai.network/discovery/listing-status?url=https://pay.example.com/api/v1/query'
```

## Channel 1 — Bazaar (automatic, needs one real payment)

The 402 response carries the declaration:

```json
"extensions": {
  "bazaar": {
    "info": {
      "input": { "type": "http", "method": "POST", "bodyType": "json",
                 "body": { "dataset_id": "web3-security", "query": "…", "mode": "local", "max_results": 5 } },
      "output": { "type": "json", "example": { "answer": "…", "sources": [ … ] } }
    },
    "schema": { "$schema": "https://json-schema.org/draft/2020-12/schema", "…": "…" }
  }
}
```

How a listing actually happens:

1. the buyer's client receives the 402 and copies `extensions` into its `PaymentPayload`
   (required by x402 v2; a client that drops `extensions` silently breaks discovery);
2. the facilitator reads it on `/verify` and `/settle` and upserts the catalogue entry;
3. the listing only becomes visible when the worker can prove the resource is paywalled: either a
   **settled** payment for a `POST` resource, or a read-only probe that returns `402`. A POST
   resource seen only through `verify` stays `resource_needs_settlement` until the first settlement.

So the practical sequence is: publish the endpoint, run one real paid query end to end, then check
`check-listing`:

```sh
cd integrations/mcp
X402_PUBLIC_BASE_URL=https://pay.example.com bun scripts/check-listing.ts
```

Rejection reasons come straight from the facilitator (`resource_host_loopback`,
`resource_host_ephemeral`, `resource_needs_settlement`, `resource_not_x402`, …). Tunnel preview
hosts (`trycloudflare.com`, ngrok, …) are refused, so use the real hostname.

`EXTENSION-RESPONSES` on the verify/settle responses is the second place to look; this service logs
settlement but does not surface that header in its own API yet.

## Channel 2 — `/.well-known/x402`

Served unpaid, `application/json`, `cache-control: public, max-age=300`:

```json
{
  "x402Version": 2,
  "kind": "resource-server",
  "name": "graphrag-ts",
  "description": "Entity/relationship GraphRAG queries with source excerpts over registered datasets.",
  "resources": [
    { "url": "https://pay.example.com/api/v1/query", "method": "POST",
      "description": "Paid relational query over a registered dataset." }
  ],
  "docs": "https://github.com/sadofriod/graphrag-ts",
  "attestation": { "type": "none" }
}
```

`X402_PUBLIC_BASE_URL` decides the URLs, so set it behind a tunnel. `updated` is intentionally
omitted: a per-request timestamp defeats caching and tells crawlers nothing.

Machines can also read `/api/v1/discovery`, which returns the same datasets in the Bazaar
`/discovery/resources` shape (resource, method, `accepts`, extension) for anything that prefers one
document over crawling the 402 of every dataset.

## Channel 3 — directories

- **402 Index** (`402index.io`) aggregates the Coinbase Bazaar hourly and also takes self
  registrations; appearing in the Bazaar is usually enough, and a manual registration only adds
  latency. Health checks treat a `402` answer as healthy.
- **x402scan** crawls `/openapi.json` / well-known manifests; an honest OpenAPI description helps,
  but the 402 challenge stays the source of truth for price.

Directory presence is not demand. Track it separately from 402s served, settlements and repeat
queries.

## Troubleshooting checklist

| Symptom | Check |
| --- | --- |
| Resource never appears in the Bazaar | Did one payment actually settle? Does the buyer client echo `extensions`? |
| `resource_needs_settlement` | Only `/verify` traffic so far — settle one real query. |
| `resource_not_x402` | The URL answered unpaid without a 402; wrong path or a redirect. |
| `resource_host_ephemeral` | Preview tunnel host; use the production hostname. |
| Listed but agents do not call it | Wrong price versus `/pricing` on the facilitator, unclear description, or the example body is not runnable. |
| `upto` settlement fails | The facilitator does not implement `upto`; switch `pricing.global.scheme` to `exact`. |

## What is still unverified

No live settlement has been run from this repository against PayAI or any other mainnet
facilitator. The declaration shape and endpoints are covered by tests; the listing lifecycle above
is documented from the facilitator's own documentation and must be confirmed with one real payment
before it is quoted as a traffic source.
