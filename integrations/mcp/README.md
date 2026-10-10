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

The Streamable HTTP endpoint is `http://127.0.0.1:3000/mcp`. After connecting, call `submit_index_job` with path `.` to index the mounted sample corpus, then use `query_graph` or `query_graph_global`. Set `INPUT_HOST_DIR` to use a different local Markdown directory. Embedding models must return 768-dimensional vectors. Never commit a real `.env` file.

PostgreSQL is not exposed on a host port, and MCP is bound to host loopback only. `docker compose down` stops the services but retains the named database volume; `docker compose down -v` deletes the indexed data.

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

- `submit_index_job`: enqueue Markdown files from the configured read-only input directory. The input is snapshotted when the job is accepted.
- `remember_text`: explicitly enqueue supplied text; chat history is never read automatically.
- `get_index_job`: retrieve job status, timestamps, a safe failure summary, and the published version.
- `query_graph`: perform local hybrid retrieval, optionally filtered by `community_level`.
- `query_graph_global`: perform corpus-wide Map-Reduce retrieval at a community level; the default level is `0`.

The input handler rejects absolute paths, `..`, and symlinks. Defaults limit each file to 2 MB, each job to 10 MB, and each job to 100 files. Queries continue to use the old snapshot during a build; failed builds do not replace the active version.

The server retains the active snapshot and the most recent versions up to `MAX_RETAINED_VERSIONS`. In-flight queries hold renewable leases on their snapshot; failed or interrupted builds have their unpublished namespace removed. `MAX_ACTIVE_QUERIES` bounds retrieval work that remains in progress after a client receives a timeout, across all HTTP sessions. HTTP sessions expire after `HTTP_SESSION_IDLE_TIMEOUT_MS` of inactivity, and at most `MAX_HTTP_SESSIONS` sessions can be open at once.

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

## Database Initialization

On first startup, the service enables pgvector and runs `prisma db push` against the bundled GraphRAG Prisma schema only when none of the required GraphRAG tables exist. Existing schemas are checked for completeness without repeatedly syncing or deleting MCP-owned tables. Idempotent SQL migrations create the MCP queue/version/lease tables and indexes, and add the community hierarchy and summary fingerprint columns required by the current GraphRAG schema. Do not run raw `prisma db push` or `--accept-data-loss` against a database containing data. The named `postgres_data` volume survives container restarts and rebuilds.

## Configuration

See the root `.env.example` for all supported settings. Set `POSTGRES_PASSWORD_URLENCODED` to the percent-encoded form of the same raw password in `POSTGRES_PASSWORD`; the raw value is used by PostgreSQL, while the encoded value is used only in the MCP connection URL. Compose reads model endpoint URLs, names, and API keys from the `COMPOSE_RAG_*` variables and maps them to the library's `RAG_*` settings inside the container. HTTP session count and idle timeout, query timeout/concurrency, snapshot retention, input/output limits, worker polling interval, and log level can also be configured through environment variables. Logs go to stderr and do not include document contents or credentials.