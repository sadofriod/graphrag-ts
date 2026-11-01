# Harness plugins

A **harness** is the wiring between graphrag-ts and the model/database services you own. Instead of spreading `RAG_*` environment variables across the shell, a harness config names one harness and supplies exactly two things:

- `models` — the chat models for slicing and judging, plus an embedding model
- `database` — a PostgreSQL + pgvector connection string (or a Prisma client passed in code)

The first built-in harness is `deepseek`. It also works as the template for your own provider.

## Why a harness

| Without a harness | With a harness |
| --- | --- |
| `RAG_SLICE_PROVIDER`, `RAG_SLICE_MODEL`, `RAG_SLICE_BASE_URL`, `RAG_SLICE_API_KEY`, and the same four for `RAG_JUDGE` / `RAG_EMBED` | One JSON file with three model entries and one database URL |
| Model defaults live in the library | Every model name, endpoint and key is yours |
| Database comes from `DATABASE_URL` at import time | `database.url` is passed to Prisma as `datasourceUrl`, or you inject a client |
| Provider adapters are fixed to the built-ins | A plugin module can register its own chat/embedding adapters |

## DeepSeek harness

DeepSeek serves chat completions only. **It has no embedding API.** The harness therefore defaults *nothing* for embeddings — you must point it at an OpenAI-compatible embedding endpoint whose output is **768 dimensions** (the schema uses `vector(768)`):

```json
{
  "harness": "deepseek",
  "database": { "url": "${DATABASE_URL}" },
  "models": {
    "slice": { "model": "${DEEPSEEK_SLICE_MODEL:-deepseek-chat}", "apiKey": "${DEEPSEEK_API_KEY}" },
    "judge": { "model": "${DEEPSEEK_JUDGE_MODEL:-deepseek-chat}", "apiKey": "${DEEPSEEK_API_KEY}" },
    "embedding": {
      "provider": "openai",
      "baseURL": "${EMBED_BASE_URL}",
      "model": "${EMBED_MODEL}",
      "apiKey": "${EMBED_API_KEY}"
    }
  }
}
```

What the harness fills in for you:

- `models.slice` / `models.judge` get `provider: "deepseek"` and `baseURL: "https://api.deepseek.com/"` unless the spec overrides them.
- `models.embedding` gets `provider: "openai"` unless overridden, but **no** base URL, model or key.
- Omitting `models.embedding` fails with: `DeepSeek provides no embedding API. Set models.embedding (provider, baseURL, model, apiKey) to your own OpenAI-compatible embedding endpoint with 768-dimensional output.`

Try it without a database or a network call:

```sh
DATABASE_URL=postgresql://user:password@localhost:5432/graphrag \
DEEPSEEK_API_KEY=sk-... \
EMBED_BASE_URL=https://your-endpoint/v1 EMBED_MODEL=your-embed-model EMBED_API_KEY=... \
bun run examples/harness/deepseek.ts --config examples/harness/graphrag.harness.example.json --check
```

`--check` only plans: it resolves the harness, builds the model configs and prints a masked summary. It opens no connection and registers no adapters.

Then build and query:

```sh
bun run examples/harness/deepseek.ts --config ./graphrag.harness.json --build ./examples/sample-corpus
bun run examples/harness/deepseek.ts --config ./graphrag.harness.json --query "What does the reset shut down?" --namespace demo
```

See [`examples/harness/README.md`](../examples/harness/README.md) for the full setup.

## Config reference

Top-level fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `harness` | yes | Built-in id (`deepseek`), a registered id, or a path to a plugin module (`./my-harness.ts`, absolute paths allowed) |
| `database` | no (MCP) / yes (CLI) | `{ "url": "postgresql://..." }`. Required by `applyHarness` unless you pass an injected client |
| `models` | yes | `slice`, `judge` and (depending on the harness) `embedding` |
| `retrievalDefaults` | no | Partial `RetrievalDefaults` (topK, rrfK, budget, concurrency, ...) |
| `buildDefaults` | no | Partial `BuildDefaults` (chunk size, overlap) |

Model spec fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `model` | yes | Model name, e.g. `deepseek-chat`, `deepseek-reasoner` |
| `apiKey` | yes | Provider key. Write `${ENV_VAR}`, never a literal |
| `provider` | no | Registered adapter id; defaults to the harness (`deepseek` for chat, `openai` for embedding) |
| `baseURL` | no | Endpoint root; chat defaults to `https://api.deepseek.com/` for the DeepSeek harness |
| `options` | no | Extra LangChain constructor options, passed through verbatim |

String values support `${VAR}` and `${VAR:-fallback}`. Missing variables without a fallback abort the load and the error lists every missing **name** — never a value. Secrets never need to appear in the file, and the summary shown by `--check` / logs masks keys (`sk-…abcd`) and credentials inside the database URL (`postgresql://user:***@host/db`, plus `password` / `secret` / `token` / `key` query parameters).

## Library usage

```ts
import { applyHarness, loadHarnessConfig } from '@ashes_born/graph-rag-ts';
// or: import { applyHarness, loadHarnessConfig } from '@ashes_born/graph-rag-ts/harness';

const config = await loadHarnessConfig('./graphrag.harness.json');
const applied = await applyHarness({ config, configPath: './graphrag.harness.json' });

try {
  // GraphRAGRetrievalService, buildRAG, startBuild, ... now use the configured models and database
} finally {
  await applied.close(); // disconnects only the Prisma client applyHarness created
}
```

`applyHarness` injects models and the Prisma client into the library singletons; it never mutates `process.env`. If you already own a client, pass it so the library does not create a second one:

```ts
const applied = await applyHarness({ config, database: { client: myPrisma } });
// applied.close() does NOT disconnect myPrisma
```

Need validation without side effects? `planHarness` returns the resolved definition, the `CustomModelConfig[]` it would build, and the masked summary, without registering adapters or connecting:

```ts
import { loadHarnessConfig, planHarness } from '@ashes_born/graph-rag-ts/harness';

const config = await loadHarnessConfig(path);
const { definition, configs, summary } = await planHarness({ config, configPath: path });
```

## Writing your own harness

A harness is a plain object validated by `defineHarness`. Register it from code, or point `harness` at a module path so the config stays self-contained:

```ts
// ./my-local-harness.ts
import { defineHarness } from '@ashes_born/graph-rag-ts/harness';
import { ChatOpenAI } from '@langchain/openai';

export default defineHarness({
  id: 'my-local',
  description: 'LM Studio chat + embeddings on localhost',
  chatProvider: 'lm-studio',
  embeddingProvider: 'lm-studio',
  defaultChatBaseURL: 'http://127.0.0.1:1234/v1',
  defaultEmbeddingBaseURL: 'http://127.0.0.1:1234/v1',
  chatAdapters: {
    'lm-studio': ({ config }) =>
      new ChatOpenAI({
        openAIApiKey: config.apiKey,
        modelName: config.model,
        configuration: { baseURL: config.baseURL },
      }),
  },
});
```

```json
{ "harness": "./my-local-harness.ts", "database": { "url": "${DATABASE_URL}" }, "models": { "...": "..." } }
```

Rules:

- `id` must match `^[a-z0-9][a-z0-9-]*$`.
- `chatProvider` is the default provider for `slice` / `judge`; `embeddingProvider` is the default for `embedding`.
- Adapters in `chatAdapters` / `embeddingAdapters` are registered when the harness is applied, so the same config can introduce a provider the library does not ship.
- `defaultChatBaseURL` / `defaultEmbeddingBaseURL` apply only when a spec omits `baseURL`; never default a secret.
- `requiresEmbedding: false` allows a harness without an embedding slot — only do this if you never call retrieval.

Plugin modules are resolved relative to the config file and cached by the module loader for the process lifetime. Re-registering the same id replaces the definition until `resetHarnesses()` restores just the built-ins.

## MCP integration

The MCP server accepts a harness config file instead of the `RAG_*` variables:

```sh
HARNESS_CONFIG=/app/harness.json
```

With `HARNESS_CONFIG` set, the service loads the file, applies the harness with its own Prisma client (from `DATABASE_URL`) and logs a masked summary. `database` can be omitted from the file in this mode because `DATABASE_URL` remains authoritative. Without it, the original `RAG_*` path is used unchanged. Mount the file into the container and see [`integrations/mcp/README.md`](../integrations/mcp/README.md).

## Failure modes

| Symptom | Cause |
| --- | --- |
| `DeepSeek provides no embedding API...` | `models.embedding` missing |
| `Missing environment variables referenced by the harness config: X, Y` | `${X}` used without a value or fallback |
| `Unknown harness 'x'. Available harnesses: deepseek` | Typo, or a plugin path that does not start with `.` or `/` |
| `No database configured...` | No `database.url` and no injected client |
| `Failed to load harness plugin ...` | Plugin module threw on import; the message includes the absolute path |
| Build fails while writing vectors | Embedding endpoint does not return 768 dimensions |
