# Hosted pilot checklist

How to run the MCP service for a small, invited pilot without turning it into an
unmanaged public service. This is operational documentation, not a guarantee of
availability: a single host behind a Cloudflare Tunnel is best-effort.

## Topology

```
agent / MCP client ──https──> Cloudflare (Access on the private hostname)
                                   │
                            cloudflared (outbound from the host)
                                   │
                     127.0.0.1:3000  MCP service
                                   │
                     127.0.0.1:5432  PostgreSQL + pgvector (never published)
```

- Bind the service to loopback (`MCP_HOST=127.0.0.1`), start `cloudflared` from
  the host, and never expose the Postgres port.
- Private hostname: Cloudflare Access email allowlist **and** the application's
  own bearer keys (`MCP_ACCESS_FILE`). Access is an outer gate, not workspace
  authorization; `/api/usage` and `/api/workspaces/*` still require a key.
- Paid hostname (only when `X402_ENABLED=true`): no Access application, because
  a login challenge would replace the `402 Payment Required` handshake. Payment
  verification is the gate; see [x402-paid-api.md](x402-paid-api.md).
- Disable host sleep and enable restart-on-boot for the tunnel and containers,
  otherwise a laptop sleep is an outage your pilot will notice.

## Two MCP hostnames, two levels of friction

A deployment can expose the same MCP service twice:

| Hostname | Gate | Use |
| --- | --- | --- |
| `mcp.<domain>` (or any hostname routed straight to the tunnel) | application bearer key only (`WWW-Authenticate: Bearer realm="graphrag"`) | pilot teams: one static token, no OAuth dance |
| portal hostname (Cloudflare MCP Portal / Access OAuth) | Cloudflare Access + OAuth (`resource_metadata=/…/oauth-protected-resource/mcp`) | clients that already speak the MCP OAuth flow |

The bearer-only hostname is the low-friction path and still enforces workspace scopes, monthly limits
and expiry from `MCP_ACCESS_FILE`; it is not anonymous. Keep the portal hostname for clients that
need OAuth, and never put the paid `pay.<domain>` hostname behind Access — the login challenge would
replace `402 Payment Required`.

## Issue credentials

```sh
cd integrations/mcp
bun src/access-key.ts   # prints { token, api_key_sha256 }
```

Give the `token` to the team once; put only the hash in the policy file:

```json
{
  "accounts": [
    {
      "id": "pilot-team-a",
      "plan": "pilot",
      "api_key_sha256": "<64 hex chars>",
      "workspaces": ["pilot-team-a"],
      "operations": ["index", "query", "read"],
      "monthly_limits": { "index": 20, "query": 500, "global_query": 20 },
      "expires_at": "2026-12-31T00:00:00.000Z"
    }
  ]
}
```

- One workspace per team, one team per workspace; the loader rejects duplicates.
- Keep the real policy file out of git (`integrations/mcp/access/*.local.json` is
  ignored; `check-credentials.ts` fails the build if one is committed).
- Rotate on expiry or on any suspected leak: issue a new key, deploy the policy,
  tell the team, then drop the old entry. Removing the entry is the revocation.
- Grant `global_query` only to teams you have explained the cost of to; a global
  run is a Map-Reduce over every leaf community.

Verify the whole policy surface before inviting anyone:

```sh
cd integrations/mcp && bun test src/access.test.ts
cd .. && bun scripts/check-credentials.ts
```

## Onboard a pilot team

1. Agree the corpus in writing. Until tenant isolation exists, use a public or
   synthetic corpus; do not ingest a pilot's private documents into a shared
   database.
2. Create the workspace, queue the corpus, and wait for `succeeded` before
   handing over the key. `get_index_job` is the source of truth.
3. Send the endpoint, the key, the five evaluation questions you will both use,
   and the example responses. Do not promise an SLA, unlimited builds, or
   isolation.
4. Confirm they can: initialize a session, call `query_graph`, see source
   excerpts, and read their own `/api/usage`.

## Weekly review

```sh
cd integrations/mcp
DATABASE_URL=… bun scripts/beta-report.ts --days 7
```

Per workspace and week this reports distinct retrieval sessions, retrieval
errors, p50/p95 latency, indexing jobs, indexing failure rate, and any settled
paid queries. Keep the numbers in one place week over week; write down every
support request and how long it took.

Continue the pilot only if at least three teams used it for two consecutive
weeks, at least two are willing to try a paid route or book a paid pilot, and
the key questions return the expected sources. Otherwise change the corpus or
the use case — do not build a marketplace or mint tokens to compensate.

## Backups and recovery

- Take a nightly `pg_dump` of the database volume to storage outside the host,
  and keep at least one offline copy.
- Restore drill, per release: restore the dump into a scratch database, point a
  scratch service at it, call `/healthz`, then run one known query and compare
  the answer's `index_version` with the live one. An untested backup is not a
  backup.
- Monitor `/healthz` every few minutes from outside the host; alert on repeated
  failures. The readiness endpoint touches the database, so it also catches a
  dead Postgres.
- Log rotation and disk checks matter more than usual on a laptop-class host: a
  full disk fails indexing, not just logging.

## Cost guardrails

- Budget alerts on the chat/embedding provider, Cloudflare, and the facilitator.
- `MAX_ACTIVE_QUERIES` caps concurrent retrievals; `QUERY_TIMEOUT_MS` caps a
  single run. Both apply to MCP and paid queries.
- Stop new indexing when a budget is hit. Absorbing a pilot's runaway ingestion
  is how a free trial becomes an unbounded bill.
- Record per-query model cost from provider invoices during the pilot, not from
  estimates, before quoting a price.

## Pre-invite checklist

- [ ] Tunnel restarts on boot; service restarts on failure; host sleep disabled.
- [ ] Postgres not reachable from the internet (`ss -ltn` shows loopback only).
- [ ] Nightly backup configured and one restore drill completed.
- [ ] `MCP_ACCESS_FILE` set; a missing/expired key gets 401, not data.
- [ ] `/healthz` returns `ready`; an alert exists for repeated failures.
- [ ] Pilot policy has one workspace per team, expiry set, minimal operations.
- [ ] `bun scripts/check-credentials.ts` passes on the deployment commit.
- [ ] Model/embedding budget alerts configured; embedding endpoint returns 768
      dimensions (checked by one successful build, not at startup).
- [ ] Corpus for the pilot is public or synthetic, in writing.
