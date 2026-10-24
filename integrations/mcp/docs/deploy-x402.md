# Deploying the paid API on a Docker host

This is the runbook used to put `POST /api/v1/query` on a real host behind a Cloudflare Tunnel.
It was executed end to end on a macOS machine with Colima as the Docker runtime; the same steps work
on any Docker host, only the `docker-compose` invocation may differ (`docker compose` v2 vs
`docker-compose` v1).

## What you end up with

| Hostname | Serves | Gate |
| --- | --- | --- |
| `pay.<domain>` | `/api/v1/*` paid API + `/.well-known/x402` | x402 payment (no account, no login) |
| `mcp.<domain>` or the existing MCP hostname | `/mcp` | application bearer key (`MCP_ACCESS_FILE`) |
| Cloudflare MCP Portal hostname (optional) | `/mcp` via OAuth | Cloudflare Access + OAuth |

Keep the paid hostname out of Cloudflare Access: an email login challenge replaces
`402 Payment Required` and no x402 client can pay through it.

## Prerequisites

- The service image can reach the facilitator (`https://api.cdp.coinbase.com` for CDP) and, when
  indexing, the model endpoints.
- Postgres volume stays where it is; the paid API reuses the same `IndexStore` pool.
- A dataset registry JSON on the host (see `../datasets.example.json`).
- Credentials for the facilitator, in a file that is **not** in the repository:
  - CDP: `CDP_API_KEY_ID` + `CDP_API_KEY_SECRET` (Ed25519 base64 secret);
  - or a bare facilitator URL (`X402_FACILITATOR_URL=https://facilitator.payai.network`) with no key.

## 1. Point the deployment checkout at the branch

```sh
cd /path/to/deploy-checkout
git fetch origin
git switch -c deploy/x402 origin/feat/x402-paid-query
git status --short          # must be clean
```

## 2. Add the settings to the deployment env

Append the block from [`../x402.env.example`](../x402.env.example) to the deployment `.env`
(back it up first: `cp .env .env.bak.$(date +%s) && chmod 600 .env.bak.*`), then set:

```sh
X402_ENABLED=true
X402_FACILITATOR_URL=https://api.cdp.coinbase.com/platform/v2/x402
X402_NETWORK=eip155:8453
X402_ASSET=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913   # USDC on Base
X402_PAY_TO=<your receiving wallet>
X402_DATASETS_FILE=/app/datasets.json
X402_PUBLIC_BASE_URL=https://pay.<domain>
CDP_API_KEY_ID=<from the CDP portal>
CDP_API_KEY_SECRET=<Ed25519 private key, base64>
```

Three values that silently break payments if they are wrong: `X402_ASSET` must be the token on
**that** network (Base USDC, not Ethereum USDC), `X402_PAY_TO` must be an EVM address for
`eip155:*`, and `X402_PUBLIC_BASE_URL` must be the hostname buyers actually call — it is what the
challenge and `/.well-known/x402` advertise.

## 3. Compose override

The repository's `docker-compose.yml` deliberately carries no x402 settings. Add
`ops/docker-compose.x402.yml` next to it:

```yaml
services:
  mcp-server:
    environment:
      X402_ENABLED: ${X402_ENABLED}
      X402_FACILITATOR_URL: ${X402_FACILITATOR_URL}
      X402_NETWORK: ${X402_NETWORK}
      X402_ASSET: ${X402_ASSET}
      X402_ASSET_NAME: ${X402_ASSET_NAME}
      X402_ASSET_VERSION: ${X402_ASSET_VERSION}
      X402_PAY_TO: ${X402_PAY_TO}
      X402_MAX_TIMEOUT_SECONDS: ${X402_MAX_TIMEOUT_SECONDS}
      X402_DATASETS_FILE: ${X402_DATASETS_FILE}
      X402_PUBLIC_BASE_URL: ${X402_PUBLIC_BASE_URL}
      CDP_API_KEY_ID: ${CDP_API_KEY_ID}
      CDP_API_KEY_SECRET: ${CDP_API_KEY_SECRET}
    volumes:
      - ./integrations/mcp/datasets.example.json:/app/datasets.json:ro
```

```sh
docker-compose -f docker-compose.yml -f ops/docker-compose.x402.yml config -q
```

`config -q` proves interpolation works; do not print the rendered config into logs or chat — it
contains your secrets.

## 4. Rebuild only the service

```sh
docker-compose -f docker-compose.yml -f ops/docker-compose.x402.yml up -d --build mcp-server
docker inspect --format '{{.State.Health.Status}}' <project>-mcp-server-1    # expect healthy
docker ps --format '{{.Names}}\t{{.Status}}'
```

Do not remove the database service or its volume. A rebuild recreates the MCP container; the
published port stays `127.0.0.1:3000`.

## 5. Verify

```sh
curl -s -o /dev/null -w 'healthz=%{http_code}\n'  https://<mcp-host>/healthz            # 200
curl -s -o /dev/null -w 'datasets=%{http_code}\n' https://<mcp-host>/api/v1/datasets    # 200
curl -s -o /dev/null -w 'wellknown=%{http_code}\n' https://<mcp-host>/.well-known/x402  # 200
curl -s -o /dev/null -w 'query=%{http_code}\n' -X POST https://<mcp-host>/api/v1/query \
  -H 'content-type: application/json' -d '{"dataset_id":"web3-security","query":"test"}'  # 402
```

`402` is the success case here: the route exists and is waiting for a payment. `401` means the
request fell through to the MCP bearer gate, i.e. the paid route is not mounted (check
`X402_ENABLED` and the container env). `500` on startup usually means a dataset registry or
facilitator setting is wrong; `docker-compose logs --tail=60 mcp-server` names the variable.

## 6. DNS and the tunnel

The paid hostname needs a proxied CNAME to the tunnel, and an ingress entry that
exposes **only the paid paths**. Both hostnames reach the same origin, and the paid
hostname has no Access gate, so anything else it serves is reachable with nothing
but a bearer key:

```yaml
ingress:
  - hostname: <mcp-host>
    service: http://localhost:3000
  - hostname: pay.<domain>
    path: ^/(api/v1/.*|\.well-known/x402)$
    service: http://localhost:3000
  - hostname: pay.<domain>
    service: http_status:404
  - service: http_status:404
```

With that ingress `/mcp`, `/api/workspaces/*` and `/healthz` answer `404` on the
paid hostname, while `/api/v1/*` and `/.well-known/x402` work — the private
hostname keeps its Access allowlist and the paid one stays payment-only. Verified
on this deployment: `pay.../mcp` → 404, `pay.../api/v1/datasets` → 200, the MCP
hostname unchanged.

With a remotely-managed tunnel the API call is
`PUT /accounts/<account>/cfd_tunnel/<tunnel-id>/configurations` with the full ingress list kept in
order, ending in `{ "service": "http_status:404" }`. The DNS record is a proxied
`CNAME pay -> <tunnel-id>.cfargotunnel.com`. Creating DNS records needs a token with
**Zone → DNS → Edit**; a tunnel-only token cannot do it.

## Known operational caveat: facilitator addresses rotate

CDP publishes `extra.facilitatorAddress` per network in `/supported`, and the value changes between
calls (observed three different addresses for Base mainnet within one hour). The service resolves it
once at startup, so a long-running process can advertise an address the facilitator no longer uses,
and `upto` payments would then build a Permit2 authorization for a stale facilitator. Until the
resolver is made refreshable, restart the service (or keep `pricing.global.scheme: "exact"`) when
selling `upto` for long periods, and re-check `/supported` if `upto` settlements start failing with a
signature/permit error. `exact` is unaffected: it has no facilitator address in the requirement.

## 7. Roll back

```sh
cp .env.bak.<timestamp> .env
docker-compose -f docker-compose.yml up -d mcp-server   # without the override
```

The old image stays on the host, so the container comes back as it was — but **the database does
not roll back with it.**

`008_x402_payments.sql` only adds tables, so rolling back past it is free. `009` is different: it
rewrites the payment status vocabulary (`pending` → `authorized`) and replaces the status check
constraint. A binary built before `009` still inserts `pending`, which the new constraint rejects, so
every paid request after a rollback fails at the ledger write. If you must go back past `009`, restore
the old vocabulary first:

```sql
ALTER TABLE x402_payments DROP CONSTRAINT IF EXISTS x402_payments_status_check;
UPDATE x402_payments SET status = 'pending' WHERE status = 'authorized';
ALTER TABLE x402_payments ADD CONSTRAINT x402_payments_status_check
  CHECK (status IN ('pending', 'settled', 'failed'));
```

The extra columns and `x402_rejected_attempts` are additive and can stay; the older binary ignores
them. Roll forward by re-applying `009`'s constraint definition once the new image is back.

Treat the first deploy of a migration that changes a constraint as a point of no easy return and run
it during a window where a failed payment for a few minutes is acceptable.

## What "verified" meant

On Base Sepolia, with CDP as facilitator: a signed `exact` request returned `200` with
`PAYMENT-RESPONSE {success:true, transaction:0x84aa…1e454, amount:"20000"}`, and the chain showed
`0.02` USDC moved from the payer to `X402_PAY_TO` in that transaction (block 49386000, 103,362 gas).
A replayed authorization is rejected by the nonce ledger; a request without a signature gets `402`.

`upto` was validated up to the payment-construction step: the challenge carries
`extra.facilitatorAddress` resolved from the facilitator's `/supported`, and the payload is a Permit2
authorization. The payer needs one ERC-20 approval to Permit2 first, and that approval costs the
payer gas — unlike `exact`, where the facilitator pays.
