# DeepSeek harness example

A harness config wires the model providers and database a GraphRAG deployment
uses, so nothing has to be passed through `RAG_*` environment variables.
`deepseek.ts` is a small CLI that validates a config, builds a corpus with it and
runs a query against the result.

Files:

- `graphrag.harness.example.json` — DeepSeek chat models plus your own embedding endpoint.
- `deepseek.ts` — `--check` / `--build` / `--query` CLI.

The same config file can drive the MCP server through `HARNESS_CONFIG`; see
[`integrations/mcp/README.md`](../../integrations/mcp/README.md) for that setup.

## Five-minute setup

1. Start PostgreSQL with pgvector (from the repository root, or use your own instance):

   ```sh
   docker compose up -d db
   ```

2. Create the schema:

   ```sh
   bun run db:push
   ```

3. Copy the example config and fill in the environment variables it references:

   ```sh
   cp examples/harness/graphrag.harness.example.json ./graphrag.harness.json
   export DATABASE_URL='postgresql://user:password@localhost:5432/graphrag'
   export DEEPSEEK_API_KEY='...'
   export EMBED_BASE_URL='https://your-embedding-endpoint/v1'
   export EMBED_MODEL='text-embedding-3-small'
   export EMBED_API_KEY='...'
   ```

   Replace `user:password` with your real PostgreSQL credentials.

4. Validate without touching the database (prints the masked summary, then `OK`):

   ```sh
   bun run examples/harness/deepseek.ts --config ./graphrag.harness.json --check
   ```

5. Index a corpus and query it:

   ```sh
   bun run examples/harness/deepseek.ts --config ./graphrag.harness.json --build ./examples/sample-corpus
   bun run examples/harness/deepseek.ts --config ./graphrag.harness.json --query "What does the reset shut down?" --namespace demo
   ```

`--config` defaults to `./graphrag.harness.json`. With no mode flag the CLI runs
`--check`. `--namespace` defaults to `demo`. Only one of `--check`, `--build` and
`--query` may be used at a time.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes (for `--build` / `--query`) | PostgreSQL connection string; may be omitted in the config when the caller injects a Prisma client. |
| `DEEPSEEK_API_KEY` | yes | Key for the slice and judge chat models. |
| `DEEPSEEK_SLICE_MODEL` | no | Slice model name, defaults to `deepseek-chat`. |
| `DEEPSEEK_JUDGE_MODEL` | no | Judge model name, defaults to `deepseek-chat`. |
| `EMBED_BASE_URL` | yes | OpenAI-compatible embedding endpoint. |
| `EMBED_MODEL` | yes | Embedding model name. |
| `EMBED_API_KEY` | yes | Key for the embedding endpoint. |

Secrets belong in the environment, never in the JSON file. The example config
only contains `${VAR}` references; `loadHarnessConfig` resolves them at load time
and its errors name missing variables without printing their values. The
`--check` summary masks API keys and the database password/secret query
parameters.

## Embeddings with DeepSeek

DeepSeek exposes chat completions only — there is no DeepSeek embedding API.
Point `models.embedding` at any OpenAI-compatible embedding endpoint that returns
**768-dimensional** vectors, which is what the database's `vector(768)` columns
expect. The harness does not default an embedding base URL for `deepseek` on
purpose: a missing `models.embedding` block fails immediately with that message.
A wrong dimension is not detected at startup; the build job fails when vectors
are written.

## Custom harness plugins

A harness is a small definition of provider wiring. Write one when your endpoint
speaks the OpenAI protocol but should have its own defaults:

```ts
// my-harness.ts
import { defineHarness } from '@ashes_born/graph-rag-ts';

export default defineHarness({
  id: 'my-local',
  description: 'Local OpenAI-compatible chat and embedding server',
  chatProvider: 'openai',
  embeddingProvider: 'openai',
  defaultChatBaseURL: 'http://localhost:1234/v1',
  defaultEmbeddingBaseURL: 'http://localhost:1234/v1',
});
```

Reference it by path from the config file; relative ids resolve against the
config file's directory. The plugin may also export the definition as a named
`harness` export.

```json
{
  "harness": "./my-harness.ts",
  "database": { "url": "${DATABASE_URL}" },
  "models": {
    "slice": { "model": "local-chat", "apiKey": "${LOCAL_API_KEY}" },
    "judge": { "model": "local-chat", "apiKey": "${LOCAL_API_KEY}" },
    "embedding": { "model": "local-embedding", "apiKey": "${LOCAL_API_KEY}" }
  }
}
```

Because the plugin defaults the base URLs, the model slots only need `model` and
`apiKey`. To add a provider that is not OpenAI- or DeepSeek-compatible, also
supply `chatAdapters` / `embeddingAdapters` on the definition; they are
registered when the harness is applied.

`--check` never connects to the database or registers adapters — it only resolves
the harness and builds the model configs — so it is safe to run in CI.
