# x402 paid query API

The MCP service can expose a metered HTTP query API that agents pay for with the
[x402 protocol](https://docs.x402.org) (protocol version 2). It is **disabled by
default**; nothing is charged and no route is mounted until `X402_ENABLED=true`.

What this gives you:

- `POST /api/v1/query` — paid retrieval against one registered dataset, with a
  source-grounded answer, the dataset version, token/usage accounting and a
  settlement receipt.
- `GET /api/v1/datasets`, `GET /api/v1/pricing` — free catalogue so a client can
  discover dataset ids and prices before paying.
- A deterministic dataset bundle exporter (`export:dataset`) and verifier
  (`verify:dataset`) for shipping a snapshot that a buyer can hash-check.

What this does **not** do: it does not wrap `/mcp` tool calls in payments (MCP
sessions are stateful; that needs a separate design), it does not mint NFTs, it
does not isolate tenants, and it has not been run against a mainnet facilitator
in this repository. See [Limits and status](#limits-and-status).

## Exposure model

Keep the paid route and the private MCP route on different hostnames:

| Route | Hostname | Gate |
| --- | --- | --- |
| `/mcp`, `/api/usage`, `/api/workspaces/*` | private hostname | Cloudflare Access allowlist + `MCP_ACCESS_FILE` bearer keys |
| `/api/v1/*` paid API | separate paid hostname | x402 payment verification only |

Do not put the x402 hostname behind a Cloudflare Access email login: an agent
would receive the Access redirect instead of `402 Payment Required`, and the
payment handshake never starts. `workspace_id` is never accepted from a paid
client; only `dataset_id` values in the registry are queryable.

## Enable it

These settings are optional and deliberately **not** part of the root `.env.example`:
copy what you need from [`../x402.env.example`](../x402.env.example) into your own deployment
environment. Compose users need their own override file; the shared `docker-compose.yml` does not
carry them.

```sh
X402_ENABLED=true
X402_FACILITATOR_URL=https://facilitator.payai.network  # no account needed to start
X402_NETWORK=eip155:8453                                # Base mainnet; 84532 for Sepolia
X402_ASSET=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913   # USDC on Base
X402_ASSET_NAME=USDC
X402_ASSET_VERSION=2
X402_PAY_TO=<your receiving wallet>
X402_MAX_TIMEOUT_SECONDS=60
X402_DATASETS_FILE=./datasets.json
X402_PUBLIC_BASE_URL=https://pay.example.com            # used in resource.url and /.well-known/x402
```

The default `pricing.global.scheme` is `"upto"`. PayAI implements `exact` (Base, Solana, …) and the
`bazaar` discovery extension, but **not** `upto`; PayAI specifically needs `"exact"` so a global
query is sold at a flat price. See
[x402-discovery.md](x402-discovery.md) for how the endpoint gets catalogued.

An `upto` challenge also needs the facilitator's `extra.facilitatorAddress`; the service resolves it
from the facilitator's `/supported` response at startup. PayAI does not support `upto`, so configure
`pricing.global.scheme: "exact"` when using PayAI.

Startup fails with the names of any missing variable and never prints values.
`X402_PUBLIC_BASE_URL` matters: without it the challenge advertises whatever
`Host` / `X-Forwarded-*` headers arrive, which is wrong behind a tunnel.

### Coinbase CDP facilitator

For Coinbase CDP, set `X402_FACILITATOR_URL=https://api.cdp.coinbase.com/platform/v2/x402`
and provide `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET`. Both credentials are required
together; requests use a fresh authenticated JWT. The API-key secret is an Ed25519
private key encoded as base64 by default (ES256 PKCS#8 keys are also supported).
CDP includes 1,000 free onchain settlements per month, then charges $0.001 per
settlement. It supports `exact`, `upto`, and batch settlement on EVM, plus Solana
`exact` and `upto`; every payment is screened for KYT and OFAC compliance.

### Dataset registry

Prices live per dataset, not in environment variables:

```json
{
  "datasets": [
    {
      "id": "web3-security",
      "workspace_id": "web3-security",
      "title": "Synthetic smart-contract security relations",
      "description": "Entity/relationship graph over a synthetic audit corpus.",
      "synthetic": true,
      "license": { "spdx": "MIT", "url": "https://github.com/sadofriod/graphrag-ts/blob/main/LICENSE" },
      "pricing": {
        "local": "$0.02",
        "global": { "scheme": "exact", "upto": "$0.10", "base": "$0.02", "per_map_answer": "$0.01" }
      },
      "tags": ["graphrag", "security"]
    }
  ]
}
```

`integrations/mcp/datasets.example.json` is a starting point. Prices are parsed
as exact decimal strings into atomic units (USDC has 6 decimals, so `$0.02` is
`"20000"`); no floating point is used. An indexing/dataset-delivery product is
deliberately **not** priced here — it needs a `upto` authorization sized from
corpus volume, and this API does not sell indexing yet.

## The paid exchange

Local retrieval uses the `exact` scheme. Global Map-Reduce can use `upto` (buyer
authorizes a ceiling and pays for the map answers the run actually used) or `exact` (flat price at
the ceiling), selected per dataset with `pricing.global.scheme`; `exact` is what a facilitator
without `upto` — including PayAI — can settle.

```sh
# 1. unpaid probe -> 402 + PAYMENT-REQUIRED header
curl -sS -D headers.txt -o body.json \
  -H 'content-type: application/json' \
  -d '{"dataset_id":"web3-security","query":"which contract re-enters through a callback?","mode":"local"}' \
  https://pay.example.com/api/v1/query

python3 - <<'PY'
import base64, json
raw = [l.split(': ',1)[1] for l in open('headers.txt') if l.lower().startswith('payment-required')][0]
print(json.dumps(json.loads(base64.b64decode(raw)), indent=2))
PY
```

The challenge carries `accepts[0]` (`scheme`, `network`, `amount`, `asset`,
`payTo`, `maxTimeoutSeconds`, `extra` with the asset name/version) and the
`bazaar` discovery extension (HTTP method, request body example, JSON Schema and
an output example) so catalogue services can index the endpoint.

```sh
# 2. retry with a signed payment payload produced by an x402 client
curl -sS -D headers2.txt -o answer.json \
  -H 'content-type: application/json' \
  -H "PAYMENT-SIGNATURE: $PAYMENT_SIGNATURE" \
  -H 'Idempotency-Key: run-2026-10-22-001' \
  -d '{"dataset_id":"web3-security","query":"which contract re-enters through a callback?","mode":"local"}' \
  https://pay.example.com/api/v1/query
```

A successful response is HTTP 200 with the `PAYMENT-RESPONSE` header (base64
`SettlementResponse`):

```json
{
  "answer": "…",
  "mode": "local",
  "dataset": { "id": "web3-security", "version": "<index version uuid>", "workspace_id": "web3-security" },
  "sources": [{ "source": "contracts/vault.md", "excerpt": "…" }],
  "usage": { "query_ms": 812, "map_answers": 0 },
  "payment": {
    "payment_id": "…", "request_id": "run-2026-10-22-001", "scheme": "exact",
    "network": "eip155:84532", "asset": "0x036CbD…", "amount": "20000",
    "payer": "0x…", "transaction": "0x…", "settled_at": "2026-10-22T16:00:00.000Z"
  }
}
```

Use a real x402 client (`@x402/fetch`, `@x402/axios`) instead of hand-rolling
signing; the repository does not ship a buyer client.

### Failure and payment semantics

| Situation | HTTP | Charge | Notes |
| --- | --- | --- | --- |
| No `PAYMENT-SIGNATURE` | 402 | none | challenge in `PAYMENT-REQUIRED` |
| Malformed / oversized header | 400 | none | never echoes the header |
| Requirements mismatch (wrong amount/asset/payTo/network/scheme) | 402 | none | fresh challenge with `error` |
| Facilitator says invalid | 402 | none | no retrieval runs; challenge returned for a clean retry |
| Capacity exhausted (shared with MCP queries) | 503 | none | no facilitator call, no key or nonce claimed |
| No published snapshot | 503 | none | payment row marked `index_not_ready` |
| Retrieval timeout (`QUERY_TIMEOUT_MS`) | 504 | none | no settle |
| Retrieval/upstream failure | 502 | none | no settle, library error text is never returned |
| Settlement rejected by the facilitator | 402 | none | answer withheld, failed settlement in `PAYMENT-RESPONSE` |
| Settlement outcome unknown (facilitator timeout / transport error) | 409 `settlement_unknown` | possibly charged | the answer is persisted; retry the same `PAYMENT-SIGNATURE` |
| Payment verified, answer still being produced | 409 `in_progress` | none yet | `Retry-After: 2`, then retry the same signature |
| Same signature, different request body | 409 | none | one paid signature covers exactly one question |
| Success | 200 | `exact` amount, or `min(upto, base + per_map_answer × map_answers)` | settlement in `PAYMENT-RESPONSE` |

Settlement only happens after the answer was produced. Money never moves for an
answer the buyer did not receive.

A facilitator timeout is **not** treated as a rejection: the row moves to
`settlement_unknown`, the generated answer is kept, and the buyer gets 409 rather
than a silent 502 with nothing to show. `scripts/reconcile-payments.ts` lists
those rows, retries settlement from the stored payload, or records an
operator-verified outcome (`--mark-settled`, `--mark-failed`) after checking the
chain.

Rows can also get stuck without ever reaching settlement: a process that dies
between inserting the `authorized` row and starting settlement leaves a payment
that no code path resolves, and every replay then answers `409 in_progress`. The
same script covers that: `--list --older-than-minutes 30` prints both
`settlement_unknown` rows and stale unsettled rows, and `--sweep` resolves them —
`authorized` becomes `failed` with `abandoned_before_settlement` (provably no
settlement was attempted, because settlement is always preceded by the `settling`
transition), while `settling` becomes `settlement_unknown` with
`stale_settling`, since money may have moved.

### Idempotency and replay

- A replay is identified by the **signed payload**, not by a header and not by the
  request body: the server stores `sha256(PAYMENT-SIGNATURE)` and serves a stored
  answer only when that signature matches. Knowing somebody's `Idempotency-Key`
  and question is not enough to read their answer.
- `Idempotency-Key` (8–200 chars of `A-Za-z0-9._:-`) is optional and still names
  the request id. When it is absent the nonce does.
- A replay of a settled request returns the stored response body and the original
  settlement, with **no** facilitator call and **no** second charge — even if the
  registry price, asset, network or payee changed in the meantime. The quote at
  the time of payment is the one that applies.
- The same signature with a different body, or a second signature against an
  already-claimed idempotency key or nonce, is a 409.
- Keys are only claimed **after** the facilitator verified the payment, so an
  invalid or unsigned attempt cannot squat somebody else's idempotency key; those
  attempts are recorded in `x402_rejected_attempts` without any unique key.
- `x402_payments` (migrations `008` + `009_x402_settlement_recovery.sql`) stores
  payment id, request id + request hash, nonce, dataset, workspace, scheme,
  authorized and settled amounts, payer, transaction, signature fingerprint,
  stored payload + requirements, the answer, dataset version, latency, settlement
  attempts and the stored response.

## Receiving wallet

`X402_PAY_TO` must be an address the chosen facilitator can settle to on `X402_NETWORK`:

- `eip155:*` networks: an EVM address (`0x` + 40 hex characters). An empty wallet is fine — the
  `exact` EVM scheme settles an ERC-3009 `transferWithAuthorization`, so the payer signs and the
  facilitator pays gas; the recipient needs no balance and no gas.
- `solana:*` networks: a base58 public key (32 bytes).

Anything else — a Tron `T...` address, a truncated value, a Solana key on an EVM network — is
rejected at startup with a message naming `X402_PAY_TO`, instead of serving a 402 challenge that no
client can pay. `X402_ASSET` is checked the same way against the network family.

An EVM address is chain-agnostic: the same `0x…` wallet receives on Base and on Ethereum, and its
EIP-55 checksum can be verified independently (a wrong checksum usually means a typo). What is *not*
chain-agnostic is the **asset** and the **facilitator support**: Base USDC
(`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`) is a different contract from Ethereum USDC
(`0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`), and PayAI's `/supported` currently lists Base,
Base Sepolia and other EVM chains plus Solana but **no `eip155:1`**. Check the facilitator's
`/supported` for the exact `network` you intend to sell on before pointing a payee at it.

## Testnet runbook

1. Create a throwaway EVM wallet for `X402_PAY_TO`; never commit its key, and
   never let the server hold a buyer key.
2. Fund a buyer wallet with Base Sepolia USDC and point a buyer client at
   `https://pay.example.com/api/v1/query`.
3. Run the two-step curl above with `X402_ENABLED=true` and the testnet
   facilitator, and check: 402 → signed retry → 200, `PAYMENT-RESPONSE` decodes,
   `amount` equals the price, and `x402_payments` shows one `settled` row.
4. Replay the same signed payload: expect the same answer, `settle` must not be
   called twice (compare `transaction` and row count).
5. Replay the same nonce with a different query: expect 409.
6. Break the facilitator URL: expect 502 and a `failed` row, never a 200.
7. Only after those pass, run a small mainnet pilot with a price you can
   recompute from usage logs.

Record for each pilot: directory impressions, 402s served, settlements, valid
answers, repeats and net revenue. Views and impressions are not demand.

## Dataset bundles

A purchasable snapshot is exported from the currently published index version:

```sh
cd integrations/mcp
DATABASE_URL=… bun scripts/export-dataset.ts \
  --dataset web3-security --workspace web3-security \
  --questions ./eval/web3-security.json \
  --created-at 2026-10-22T00:00:00.000Z \
  --out ./exports

bun scripts/verify-dataset.ts --dir ./exports/web3-security/<version>
```

The bundle contains `entities.jsonl`, `relationships.jsonl`,
`communities.jsonl`, `sources.json` (provenance hashes, never source bodies),
`eval-questions.json`, `schema.json`, `LICENSE.txt` and `manifest.json` with a
per-file SHA-256 list and a `bundle_sha256`. Canonical JSON and sorted rows make
the output byte-identical for the same input and `--created-at`; shuffling input
order does not change any hash. Buyers can recompute the manifest independently.

Before selling a bundle: confirm redistribution rights for every source, keep
raw text out of the public bundle unless licensed, and put paid downloads behind
a short-lived signed URL after settlement. An on-chain token does not create a
licence, so write the licence separately.

## Pilot operations

```sh
cd integrations/mcp
bun scripts/check-credentials.ts          # fails if a secret is committed
DATABASE_URL=… bun scripts/beta-report.ts --days 7   # weekly pilot metrics
```

`beta-report.ts` prints per workspace and ISO week: distinct retrieval sessions,
retrieval errors, p50/p95 latency from activity logs, indexing jobs and failure
rate, and settled paid queries with their atomic amounts. `--json` gives the same
data for a spreadsheet. It reads only `workspace_activity_logs`, `index_jobs` and
`x402_payments`; nothing leaves the host.

Guardrails: set provider budget alerts (DeepSeek, embedding, Cloudflare,
facilitator), pause new indexing when a budget is hit instead of absorbing
unbounded buyer usage, and keep a restore drill for the database before selling
anything that a customer depends on.

## Limits and status

- **Testnet only so far.** The wire format follows x402 v2 (`PAYMENT-REQUIRED`,
  `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE`, `/verify`, `/settle`), and the
  handler is covered by unit tests plus one real-HTTP round trip against a fake
  facilitator. A live testnet settlement is still required before quoting a
  price; a real facilitator's `/verify` semantics for `upto` should be confirmed
  in that run.
- **Usage metering is a proxy.** Global mode settles from the number of Map
  answers actually used, not from provider token counts, because retrieval does
  not report token usage today. Treat the per-answer price as an experiment
  variable and reconcile it against provider bills.
- **No MCP tool payment.** `/mcp` keeps its bearer-key and monthly-quota model.
  Charging individual MCP tool calls needs per-tool accounting and a payment
  binding for stateful sessions.
- **No tenant isolation.** One workspace per dataset, registered server-side;
  a paid client cannot choose a workspace. Private corpora are out of scope until
  there is an authorization mapping from payer to workspace.
- **Ledger write after settlement.** If the payment row cannot be updated
  after a successful settlement, the buyer still receives the answer and the
  receipt; the row stays `pending` and the server logs
  `Paid query ledger write failed after settlement.` with the payment id and
  transaction. Reconcile those rows against the facilitator before the same
  nonce is retried.
- **No refund automation.** Failed or timed-out requests are simply not settled;
  already-settled disputes are manual.
- **Best-effort availability.** This is designed for a single host behind a
  Cloudflare Tunnel, not an SLA. Sell a snapshot or an integration contract if a
  customer needs durability guarantees.
