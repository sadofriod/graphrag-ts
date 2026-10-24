# GraphRAG MCP Server

A local GraphRAG MCP service for Markdown corpora. Index jobs are stored in a PostgreSQL queue and processed by a single worker. Each build creates a complete snapshot in a separate namespace; the service publishes it only after a successful build. Queries always use the latest successfully published snapshot.

## Quick Start

The Docker Compose setup runs PostgreSQL with pgvector and the MCP server. It does not include an LLM; configure an OpenAI-compatible chat and embedding endpoint that the container can reach. The default input mount is `examples/sample-corpus`.

From the repository root:

```sh
cp .env.example .env
# Set a strong POSTGRES_PASSWORD, its percent-encoded copy in POSTGRES_PASSWORD_URLENCODED, and configure the COMPOSE_RAG_* endpoints and models.
docker compose up -d --build
curl http://127.0.0.1:3000/healthz
```

The Streamable HTTP endpoint is `http://127.0.0.1:3000/mcp`. After connecting, call `submit_index_job` with path `.` to index the mounted sample corpus, then use `query_graph` or `query_graph_global`. All indexing, text-ingestion, job-status, and query tools accept `workspace_id`; it defaults to `default` for existing clients. Use the same ID for every operation on a corpus. Set `INPUT_HOST_DIR` to use a different mounted Markdown directory. Embedding models must return exactly 768-dimensional vectors, matching the database's `vector(768)` columns. The service does not probe embedding dimensions at startup: an incompatible endpoint may still let the service become ready, and the mismatch is detected when an indexing job writes vectors. Check the model's documented/default output dimensions or call its embedding endpoint and confirm the returned vector has 768 values before submitting a job; if the model supports a dimension option, configure it to 768. In Docker Compose, `COMPOSE_RAG_EMBED_*` values take precedence over `RAG_EMBED_*`, so verify the effective endpoint and model. A mismatch fails the job (`BUILD_FAILED`) without replacing the currently published snapshot. Never commit a real `.env` file.

For the optional browser showcase, configure reachable slice, judge, and embedding models first, then run `docker compose --profile showcase up -d --build --wait` from the repository root and open `http://127.0.0.1:8080`. A model/API failure is shown in the page as an error dialog; check the `COMPOSE_RAG_*` endpoint, model, API key, provider, and embedding dimensions in `.env`. Example values in `.env.example` do not mean a model server is running.

PostgreSQL is not exposed on a host port, and MCP is bound to host loopback only. `docker compose down` stops the services but retains the named database volume; `docker compose down -v` deletes the indexed data.

## Paid query API (optional)

The service can also expose `POST /api/v1/query`, an x402 (v2) paid HTTP endpoint for agents, next to the free `/api/v1/datasets` and `/api/v1/pricing` catalogue. It is disabled unless `X402_ENABLED=true`, prices come from a dataset registry file (`integrations/mcp/datasets.example.json`), and `dataset_id` — never `workspace_id` — selects the corpus. Local retrieval is charged with the `exact` scheme, global Map-Reduce with `upto`, and settlement happens only after an answer was produced. See [`x402.env.example`](x402.env.example) for the optional settings; Compose users must add the variables they need to their own Compose override.

Extension points are the facilitator URL, network/asset and `X402_PAY_TO`; see [docs/x402-paid-api.md](docs/x402-paid-api.md) and the deployment runbook [docs/deploy-x402.md](docs/deploy-x402.md) for the wire format, failure table, idempotency rules, testnet runbook and the dataset bundle exporter (`bun scripts/export-dataset.ts`). Pilot operation is covered in [docs/hosted-beta.md](docs/hosted-beta.md): Cloudflare Access for the private MCP hostname, a separate paid hostname for `/api/v1/*`, credential issuance and rotation, weekly metrics (`bun scripts/beta-report.ts`) and the committed-credential check (`bun scripts/check-credentials.ts`).

## VS Code with Docker and Environment Injection

This configuration launches the MCP server as a Docker Compose stdio process. First copy the root `.env.example` to `.env` and set the database password there. Start only the database service; do not also run the `mcp-server` Compose service while using this configuration, because the application permits only one indexing worker at a time.

```sh
docker compose up -d --wait db
```

Save the following as `.vscode/mcp.json` in the repository. Replace the model settings with values for your environment. The `env` object is passed to Docker Compose and supplies values interpolated into the MCP container environment. Database credentials come from the root `.env` so the database and MCP process use the same password.

```json
{
  "servers": {
    "graphrag": {
      "type": "stdio",
      "command": "docker",
      "args": [
        "compose",
        "--project-directory",
        "${workspaceFolder}",
        "run",
        "--rm",
        "-T",
        "--no-deps",
        "-e",
        "MCP_TRANSPORT=stdio",
        "mcp-server"
      ],
      "env": {
        "INPUT_HOST_DIR": "${workspaceFolder}/examples/sample-corpus",
        "COMPOSE_RAG_SLICE_BASE_URL": "http://host.docker.internal:1234/v1",
        "COMPOSE_RAG_SLICE_MODEL": "local-model",
        "COMPOSE_RAG_SLICE_API_KEY": "lm-studio",
        "COMPOSE_RAG_JUDGE_BASE_URL": "http://host.docker.internal:1234/v1",
        "COMPOSE_RAG_JUDGE_MODEL": "local-model",
        "COMPOSE_RAG_JUDGE_API_KEY": "lm-studio",
        "COMPOSE_RAG_EMBED_BASE_URL": "http://host.docker.internal:1234/v1",
        "COMPOSE_RAG_EMBED_MODEL": "local-embedding-model",
        "COMPOSE_RAG_EMBED_API_KEY": "lm-studio"
      }
    }
  }
}
```

Values supplied in `.vscode/mcp.json` take precedence over matching model settings in the root `.env` file. Keep real API keys in a local, untracked MCP configuration or use your editor's secret/input mechanism; do not commit them. On macOS and Windows, `host.docker.internal` reaches a model server running on the host. On other systems, set each model URL to an address reachable from the Compose network.

## MCP Tools

- `submit_index_job(workspace_id, path)`: enqueue Markdown files from the configured read-only input directory. The input is snapshotted when the job is accepted.
- `remember_text(workspace_id, text)`: explicitly enqueue supplied text; chat history is never read automatically.
- `get_index_job(workspace_id, job_id)`: retrieve a job only when it belongs to the requested workspace.
- `query_graph(workspace_id, query)`: perform local hybrid retrieval against that workspace's latest published snapshot, optionally filtered by `community_level`.
- `query_graph_global(workspace_id, query, community_level)`: perform corpus-wide Map-Reduce retrieval over terminal community summaries by default. Set `community_level` to a non-negative integer to use exactly that hierarchy level, or `"leaf"` to explicitly select all terminal communities across uneven branches.

`workspace_id` is a logical, lowercase slug (1-63 characters: letters, digits, and hyphens; it must start with a letter or digit). Each workspace has an independent job queue position, source set, active snapshot, query leases, and snapshot-retention window. Snapshot namespaces remain server-generated and are not accepted as tool arguments or returned as workspace selectors. A workspace ID is a routing/isolation key, not an authentication credential; deployments serving mutually untrusted users must enforce identity-to-workspace authorization at the MCP gateway.

Use the same workspace ID when submitting, polling, and querying:

```json
{"name":"submit_index_job","arguments":{"workspace_id":"product-docs","path":"."}}
{"name":"get_index_job","arguments":{"workspace_id":"product-docs","job_id":"<job_id>"}}
{"name":"query_graph","arguments":{"workspace_id":"product-docs","query":"Which products are mentioned?"}}
{"name":"query_graph_global","arguments":{"workspace_id":"product-docs","query":"Which themes connect the documents?","community_level":"leaf"}}
```

Omitting `workspace_id` selects `default`, preserving the original single-workspace behavior. A query in a different, not-yet-indexed workspace returns `INDEX_NOT_READY`; it does not fall back to another workspace's active snapshot.

The input handler rejects absolute paths, `..`, and symlinks. Defaults limit each file to 2 MB, each job to 10 MB, and each job to 100 files. Queries continue to use the old snapshot in the same workspace during a build; failed builds do not replace that workspace's active version.

The server retains the active snapshot and the most recent versions up to `MAX_RETAINED_VERSIONS`. In-flight queries hold renewable leases on their snapshot; failed or interrupted builds have their unpublished namespace removed. `MAX_ACTIVE_QUERIES` bounds retrieval work that remains in progress after a client receives a timeout, across all HTTP sessions. HTTP sessions expire after `HTTP_SESSION_IDLE_TIMEOUT_MS` of inactivity, and at most `MAX_HTTP_SESSIONS` sessions can be open at once.

## Incremental Snapshots and Global Answers

Within a workspace, a source label (normally the Markdown path) identifies a document. Re-submitting that label replaces its previous content; the existing `content_hash` determines whether it changed. Identical content reuses the source record and skips extraction. Each job clones the active graph into an isolated namespace and builds only changed sources. Old snapshots remain available to leased queries. A submission does not delete other source labels that were omitted from the input.

`remember_text` without an explicit source uses `remembered-<content_hash>.md`: different text creates independent memories, and identical text is deduplicated. Supply the same explicit source label to update an existing memory.

Edges store separate contributions per parent document. Replaying a parent replaces only its contribution; deleting it removes only its contribution. Contributions are summed transactionally, including concurrent writes, and are copied with the snapshot. Use the library's document-deletion APIs rather than deleting parent rows directly, so aggregated edge weights are refreshed.

Community summary rows are reused when the member set and hierarchy level are unchanged, with changed content regenerated in place. Snapshot rows still receive new physical IDs. Global Map prompts use member/level-derived logical IDs and sorted evidence, so copied UUIDs and database row order do not shuffle unchanged input. Legacy summaries without members fall back to their physical IDs. Adding a community preserves the relative ordering of existing communities, but token packing can still change batch boundaries. Changed builds still run full-graph community detection; this is not a partial-subgraph Leiden implementation.

MCP enables persistent global-answer caching. The core library keeps it opt-in through `options: { responseCache: true }`. Cache keys include the namespace, query, actual evidence batches, prompt templates, retrieval settings, and configured model identity (excluding API keys). Concurrent identical requests share one successful generation across processes. Only `completed` results are stored; empty, partial, failed, and aborted generations are not. Evidence/configuration changes invalidate the key; externally changing a model behind an unchanged endpoint/name requires changing its configured identity or clearing the cache. Injected model objects use a process-local identity.

Cache rows are not cloned and are deleted with their snapshot. There is no per-query TTL or size quota within a retained snapshot. A cache miss holds a database transaction/connection during generation (up to five minutes); size the pool for the configured query concurrency. Stable input and cached success do not guarantee identical fresh LLM responses across different snapshots or cache misses.

## Development and Validation

Install dependencies from the repository root and start the service locally:

```sh
pnpm install
pnpm --filter graphrag-mcp-server dev
```

Local development requires a reachable PostgreSQL+pgvector instance and OpenAI-compatible model endpoints. The service uses the same guarded schema initialization as the container. You can run `pnpm --filter graphrag-mcp-server db:push` for a protected schema initialization/integrity check; MCP-owned tables are applied by the service's SQL migrations.

```sh
pnpm --filter graphrag-mcp-server build
pnpm --filter graphrag-mcp-server test
docker compose --env-file .env.example config --quiet
```

The snapshot regression suite can use an isolated PostgreSQL+pgvector database with the current Prisma schema. It exercises contribution replay/deletion/concurrency, snapshot references and rollback, source-version publication, and answer-cache invalidation. Never point it at a production database:

```sh
DATABASE_URL="$TEST_DATABASE_URL" MCP_TEST_DATABASE_URL="$TEST_DATABASE_URL" \
  RAG_SLICE_API_KEY= RAG_JUDGE_API_KEY= RAG_EMBED_API_KEY= NODE_ENV=test \
  pnpm exec bun test integrations/mcp/src/snapshot.postgres.test.ts
```

To run the recall benchmark through a running Docker MCP server, mount the generated benchmark corpus as `INPUT_HOST_DIR` and run:

```sh
MCP_BENCHMARK_URL=http://127.0.0.1:3000/mcp pnpm --filter graphrag-mcp-server benchmark
```

The runner submits the mounted corpus through `submit_index_job`, waits for publication, and sends two query sets through `query_graph`. It preserves the original 12 scope probes, marks the five questions whose chapters are indexed as positive controls, and measures explicit refusal, returned sources, and expected-phrase leakage across the seven questions whose chapters are absent. It then reports recall for a separate 12-question set drawn only from indexed chapters. The refusal check is a text-pattern heuristic, so it should be reviewed alongside the returned answers and source excerpts. MCP answer/source recall is not directly comparable to the library benchmark, which evaluates internal evidence and community context.

Set `MCP_BENCHMARK_SKIP_BUILD=true` to reuse the currently published snapshot and rerun only the queries.
Set `MCP_BENCHMARK_ONLY_IN_CORPUS=true` with `MCP_BENCHMARK_SKIP_BUILD=true` to run only the indexed-corpus recall set.
Set `MCP_BENCHMARK_PROFILE=quick` to run the three questions bundled with `examples/quickstart-corpus` and omit the scope probes. The repository-root `pnpm benchmark:docker:quick` command selects that corpus, builds/waits for Docker Compose, and runs the benchmark inside the MCP container, so host-side Bun dependencies are not required.

## Database Initialization

On first startup, the service enables pgvector and runs `prisma db push` against the bundled GraphRAG Prisma schema only when none of the required GraphRAG tables exist. Existing schemas are checked for completeness without repeatedly syncing or deleting MCP-owned tables. Idempotent SQL migrations create the MCP queue/version/lease tables and indexes, add the community hierarchy and summary fingerprint columns required by the current GraphRAG schema, and migrate the active-index pointer from the legacy single workspace to per-workspace rows. Existing jobs and versions are assigned to `default`. Do not run raw `prisma db push` or `--accept-data-loss` against a database containing data. The named `postgres_data` volume survives container restarts and rebuilds.

MCP startup also applies `006_edge_contributions.sql`, `007_global_query_cache.sql` and, when the paid API is enabled, `008_x402_payments.sql`. Library-only installations using Prisma migration history should apply `0004_edge_contributions` and `0005_global_query_cache` with `pnpm exec prisma migrate deploy`, then run `pnpm exec prisma generate`. Use the deployment's existing migration mechanism; do not mix Prisma migration history and MCP-owned schema initialization on the same database without baselining it first.

The edge migration preserves each legacy edge's currently recorded weight under its representative parent. The old schema did not retain every contributing parent, so migrations cannot reconstruct lost contributions or undo previously inflated totals. For historically correct weights, rebuild the full corpus into a fresh namespace/workspace after upgrading; merely re-submitting unchanged files will be skipped by their fingerprints. Existing snapshots are not silently rebuilt.

## Configuration

See the root `.env.example` for all supported settings. Set `POSTGRES_PASSWORD_URLENCODED` to the percent-encoded form of the same raw password in `POSTGRES_PASSWORD`; the raw value is used by PostgreSQL, while the encoded value is used only in the MCP connection URL. For models, Compose-specific `COMPOSE_RAG_*` variables take precedence; otherwise it reuses the root `.env` `RAG_*` endpoint, model, provider, and API-key values. Set chat provider to `openai` for LM Studio/OpenAI-compatible endpoints; the container's embedding URL defaults to `http://host.docker.internal:1234/v1` for a model server on the host. The configured embedding model must return exactly 768 values per vector; this is checked by pgvector during indexing, not during service startup. HTTP session count and idle timeout, query timeout/concurrency, snapshot retention, input/output limits, worker polling interval, and log level can also be configured through environment variables. Logs go to stderr and do not include document contents or credentials.
