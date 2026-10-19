# Commercial delivery paths

This branch adds commercial delivery foundations, not a payment processor or a
claim of revenue. The MIT engine remains usable without an account. Prices,
taxes, contracts, refunds and third-party marketplace listings remain operator
responsibilities.

## Capability audit

| Surface | Existing baseline | Added delivery capability |
| --- | --- | --- |
| MCP | Workspace routing, queued builds, snapshot isolation, local/global queries | Opt-in bearer accounts, explicit operation grants, expiry, workspace ownership and durable monthly admission limits |
| Local showcase | Graph, job and retrieval activity views; no login | HTTP data endpoints are account-scoped in hosted mode; local UI remains a local-only demo |
| Datasets | Markdown corpora and engine schema | Original synthetic security sample, validated licensed relation bundles and deterministic SQL/JSONL/Markdown delivery |
| Agent distribution | Generic MCP / VS Code example | [Hermes/OpenClaw configurations](../integrations/mcp/clients/README.md) and [decision-history scenario](../examples/project-history/README.md) |

The promotion drafts' small lexical benchmark does not establish that GraphRAG
beats vector RAG. No adoption, marketplace acceptance, vulnerability coverage,
provider-token cost or revenue is inferred from tests.

## 1. Hosted MCP: subscription or contracted usage allowance

Sell a **service allowance**, not the MIT source license. An account can have
several exclusive workspaces; its quota is shared across all of them and all its
HTTP sessions. `plan` is an operator-supplied contract label, not a billing SKU.

From the repository root:

```sh
bun integrations/mcp/src/access-key.ts
cp integrations/mcp/access/accounts.example.json integrations/mcp/access/accounts.local.json
```

Store the generated token in the customer's secret manager and copy only its
`api_key_sha256` into the local account file. Change the ID, unique workspace
slugs, expiry, operation grants and monthly limits to match the agreed offer.
The all-zero example hash deliberately authenticates no supplied example token.
Do not capture real credentials in public logs, recordings or tickets.

For Compose, set `MCP_ACCESS_FILE=/app/access/accounts.local.json` in the root
`.env`, then recreate the MCP service. The access directory is mounted read-only.
For direct Bun execution, set `MCP_ACCESS_FILE` to the host file's path instead.
Malformed policies or missing files fail startup; authenticated stdio is rejected.
An empty/unset value intentionally retains the original unauthenticated local
mode. Never use that mode for mutually untrusted customers.

Example offer shapes (not market-tested prices):

| Offer | Grants | Allowance / delivery |
| --- | --- | --- |
| Evaluation | `index`, `query`, `read` | Small monthly limits, explicit short expiry |
| Team subscription | `index`, `query`, `global_query`, `read` | Contracted monthly local/global/index attempts, separate team workspaces |
| Private deployment | Customer-operated installation | Setup, data import, operational handoff and optional support contract |

All three meter limits must be explicit, including zeros. The policy rejects
duplicate account IDs, hashes and workspace ownership. A workspace is still not
a credential. Omitting the tool argument selects `default`, which is denied
unless that account owns `default`.

### Admission accounting contract

- `remember_text` consumes one `index` unit after validating its input, before
  enqueueing; global and local queries have separate units.
- Units count **admitted tool attempts**, not successful answers, tokens, dollars,
  invoices or completed builds. Once admitted, failures, no-index responses,
  capacity errors, disconnects and retries still count. This avoids refunding
  already-started provider work; communicate the policy before charging.
- Invalid tool schemas, unauthorized workspaces/operations and rejected filesystem
  ingestion do not consume units. Job polling and dashboard reads are unmetered.
- Atomic PostgreSQL upserts enforce a shared allowance under concurrent requests.
  The UTC calendar month is computed by PostgreSQL. Counts survive restarts and
  key rotation when the account ID is retained. Old periods remain for operator
  reconciliation; there is no automatic overage billing or retention purge.
- Exhaustion returns MCP `isError` with `QUOTA_EXCEEDED`; unauthorized tools return
  `FORBIDDEN`. Missing/invalid/expired HTTP credentials return `401`. A failed
  quota write stops work; it never grants a free request.
- `submit_index_job` is disabled for **all** hosted accounts: the common input
  mount is not tenant-isolated. Ingest explicitly supplied text instead.
- Policies are immutable for a running process. Revocation, rotation, plan changes
  and renewal require a restart, which invalidates old MCP sessions. Keep account
  IDs stable across renewals; changing an ID creates a different ledger identity.

Read the current account's allowance (credential comes from a local environment
variable; do not save shell output containing it):

```sh
curl -H "Authorization: Bearer $GRAPHRAG_API_KEY" http://127.0.0.1:3000/api/usage
```

Response: `account_id`, `plan`, `expires_at`, UTC `period` (`YYYY-MM`),
`unit: "admitted_tool_attempt"`, and `usage` entries with `operation`, `used`,
`limit`, `remaining`. The response is `Cache-Control: no-store`.

### Deployment boundary

Keep the Compose loopback binding. Put a trusted TLS reverse proxy in front that
forwards `Authorization`, preserves MCP session headers and streaming, and sets
upstream `Host: localhost:3000`. Enforce network isolation, rate limits, request
size limits, timeouts and abuse controls there. Never expose the Bun listener
directly based on its Host-header check; Host is not a network firewall.

The local web showcase has no credential-entry/login workflow. In hosted mode its
unauthenticated requests fail rather than exposing another customer's data. Use
authenticated MCP clients/API calls, not the showcase, for customer access.
Do not inject a shared customer token into the browser bundle or proxy. No OAuth,
self-service signup, payment webhook, invoice generation, per-customer worker
fairness or production availability guarantee is claimed.

## 2. Curated datasets: samples, full licensed bundles and updates

Use the [security dataset delivery CLI](../examples/web3-smart-contract-security/README.md)
to validate and package seller-owned relation data. The small included dataset is
original **fictional demo data**, not a commercial security feed, audited contract
database or investment/compliance recommendation.

Free sample -> buyer runs MCP against the Markdown corpus -> seller verifies
rights and negotiates a separate full-data license -> buyer receives a versioned,
checksummed JSONL/SQL/Markdown bundle. The SQL tables preserve curated relations;
Markdown ingestion still performs the engine's normal model-assisted extraction.
It does not directly import curated triples into the internal graph tables.

Hugging Face/Kaggle/GitHub can distribute properly licensed samples. Ocean,
dFusion and other marketplaces require separate account, current platform/API and
legal verification. No automatic listing, NFT minting, gated download service or
license-key DRM is implemented. License metadata records assertions; it cannot
prove redistribution rights. Do not scrape or republish third-party reports
without permission.

## 3. Enterprise delivery and support

Deliver a customer-owned PostgreSQL deployment plus a validated dataset bundle,
model-endpoint configuration, workspace/credential policy and acceptance run.
Back up the graph, source snapshots and `mcp_usage` together. The existing single
index worker and query concurrency limits still apply; adding authentication does
not turn this into a horizontally scaled SaaS.

This path can be sold as setup/custom annotation, data refresh, or maintenance
services independently of a hosted subscription. It does not require inventing
a restrictive engine license or collecting a wallet/key in the application.

## Validation

```sh
pnpm typecheck
pnpm test
pnpm exec eslint .
pnpm --filter graphrag-mcp-server build
# Dedicated test database with CREATE SCHEMA permission; never production:
MCP_TEST_DATABASE_URL=... bun test integrations/mcp/src/usage.test.ts
# Include both database-backed checks in the full suite:
MCP_TEST_DATABASE_URL=... WEB3_DATASET_TEST_DATABASE_URL=... pnpm test
```

The MCP tests also exercise the official SDK over a real loopback HTTP listener,
including initialization, discovery, authenticated ingestion and session termination.
The database test creates and drops a uniquely named test schema, checks migration
replay, 30 concurrent admissions capped at 7, cross-pool persistence, zero quotas,
plan changes, account isolation and month isolation. Without the explicit test
database variable it is skipped, not counted as a database pass.

On the starting branch, full-repository ESLint also scans the generated web-demo
bundle and reports existing size/complexity violations in the workspace layout,
dashboard hook, MCP store and worker. New commercial modules can be linted
independently, but a passing targeted check must not be presented as a clean
full-repository lint result.

External acceptance still needed: live Hermes/OpenClaw runs, model-backed
decision-history comparison, real data-rights review, customer pricing and
payment fulfillment, directory submissions and marketplace publication.
