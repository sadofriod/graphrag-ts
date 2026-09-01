# graphrag-ts

> This repository is maintained as a standalone project. For the Chinese guide, see [docs/zh-CN.md](docs/zh-CN.md). For the English guide, see [docs/en-US.md](docs/en-US.md).

`graphrag-ts` is a TypeScript-first GraphRAG reference implementation for Markdown corpora. It transforms a collection of Markdown documents into a searchable knowledge graph and supports LLM-based chunking, deterministic fallback logic, community detection, and hybrid retrieval.

## 1. Project overview

- Use cases: knowledge bases, document graphs, enterprise document retrieval, evidence-grounded Q&A
- Core capabilities: Markdown chunking, embedding pipelines, entity/edge/claim modeling, community summary, hybrid recall, evidence aggregation
- Stack: TypeScript + Prisma + PostgreSQL + pgvector + Bun + pnpm

## 2. Requirements

- [pnpm](https://pnpm.io/) 10+
- [Bun](https://bun.sh) 1.1+
- PostgreSQL with [pgvector](https://github.com/pgvector/pgvector) enabled
- Two model types:
  - chat model (for example, a DeepSeek-compatible endpoint with JSON output support)
  - embedding model (for example, an OpenAI-compatible endpoint or LM Studio)

## 3. Node module injection pattern

When this package is consumed as a Node module, callers should not depend on repository-local `model.config.json` or implicit environment loading. The recommended pattern is to inject configuration at runtime.

```ts
import { injectModelConfigs } from '@ashes_born/graph-rag-ts/model-loader';
import { injectPrismaClient } from '@ashes_born/graph-rag-ts/prisma-client';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
injectPrismaClient(prisma);

await injectModelConfigs([
  {
    type: 'slice',
    baseURL: process.env.RAG_SLICE_BASE_URL!,
    model: process.env.RAG_SLICE_MODEL!,
    apiKey: process.env.RAG_SLICE_API_KEY!,
  },
  {
    type: 'judge',
    baseURL: process.env.RAG_JUDGE_BASE_URL!,
    model: process.env.RAG_JUDGE_MODEL!,
    apiKey: process.env.RAG_JUDGE_API_KEY!,
  },
  {
    type: 'embedding',
    baseURL: process.env.RAG_EMBED_BASE_URL!,
    model: process.env.RAG_EMBED_MODEL!,
    apiKey: process.env.RAG_EMBED_API_KEY!,
  },
]);
```

This keeps runtime configuration external to the published package and allows the library to run in different application environments.

The project also supports Bun direct execution for local development:

```bash
cp .env.example .env
pnpm install
pnpm run db:push
bun test
bun run examples/demo.ts
```

The two entry paths coexist:

- Node module path: inject configuration through `inject*` functions
- Bun direct-run path: use `.env` plus `bun run ...`

## 4. Required runtime parameters

When this package is installed into another project, the consumer must provide runtime configuration before the GraphRAG pipeline can initialize. At minimum, provide:

- `DATABASE_URL`
- `RAG_SLICE_*`
- `RAG_JUDGE_*`
- `RAG_EMBED_*`
- a model config array equivalent to `src/build/model.config.json`

Example `.env`:

```bash
DATABASE_URL="postgresql://user:pass@localhost:5432/graphrag?schema=public"

RAG_SLICE_API_KEY="your-slice-key"
RAG_SLICE_MODEL="deepseek-chat"
RAG_SLICE_BASE_URL="https://api.deepseek.com/"

RAG_JUDGE_API_KEY="your-judge-key"
RAG_JUDGE_MODEL="deepseek-chat"
RAG_JUDGE_BASE_URL="https://api.deepseek.com/"

RAG_EMBED_API_KEY="your-embedding-key"
RAG_EMBED_MODEL="local-embedding-model"
RAG_EMBED_BASE_URL="http://127.0.0.1:1234/v1"

RAG_COMMUNITY_CONTEXT_MAX_TOKENS=4000
```

Runtime model config equivalent to `src/build/model.config.json`:

```json
[
  {
    "baseURL": "https://api.deepseek.com/",
    "model": "deepseek-v4-flash",
    "apiKey": "your-slice-key",
    "type": "slice"
  },
  {
    "baseURL": "https://api.deepseek.com/",
    "model": "deepseek-v4-flash",
    "apiKey": "your-judge-key",
    "type": "judge"
  },
  {
    "baseURL": "http://127.0.0.1:1234/v1",
    "model": "your-embedding-model",
    "apiKey": "your-embedding-key",
    "type": "embedding"
  }
]
```

> These values should be supplied by the consumer at deployment time via environment variables, a config center, or a secret manager; they should not be hard-coded into the published package.

## 5. Quick start

```bash
# 1. Install dependencies (pnpm; Prisma postinstall runs automatically)
pnpm install

# 2. Generate the Prisma client
pnpm run db:generate

# 3. Copy and fill in environment variables
cp .env.example .env
# Required at minimum:
#   DATABASE_URL
#   RAG_SLICE_API_KEY
#   RAG_JUDGE_API_KEY
#   RAG_EMBED_API_KEY

# 4. Create database tables
pnpm run db:push

# 5. Run unit tests (no real DB or real LLM required)
bun test

# 6. Run the example script
bun run examples/demo.ts
```

## 6. Benchmark

```bash
bun run benchmark --build --base-url http://localhost:3000
```

This benchmark simulates a sample corpus and evaluates the full GraphRAG pipeline, including retrieval quality. It requires a real database and configured model services.

## 7. Repository structure

| Path | Type | Description |
| --- | --- | --- |
| `src/build/` | core | Chunking, community detection, entity/edge/claim construction |
| `src/retrieval/` | core | Query intent, recall, ranking, evidence, answer generation |
| `src/benchmark/` | core | Benchmark scripts, datasets, and reports |
| `src/namespace/` | core | Multi-tenant namespace isolation |
| `examples/` | maintained | Example code and sample corpora |
| `docs/` | maintained | Design notes, comparison, and historical migration notes |
| `_migration/` | legacy | Historical migration cache and compatibility scripts |

## 8. Reference projects

This project draws inspiration from several TypeScript and GraphRAG implementations, including:

- [pingcap/autoflow](https://github.com/pingcap/autoflow)
- [abhigyanpatwari/GitNexus](https://github.com/abhigyanpatwari/GitNexus)
- [talperetz/browsegraph](https://github.com/talperetz/browsegraph)

Compared with those projects, this repo emphasizes:

- a learning-oriented reference implementation
- PostgreSQL + pgvector as the storage core
- clean module boundaries for easier extension
- explicit deterministic fallback mechanisms

## 9. Documentation index

- [docs/architecture.md](docs/architecture.md): architecture overview
- [docs/migration.md](docs/migration.md): historical migration notes
- [docs/comparison.md](docs/comparison.md): comparison with other projects
- [docs/en-US.md](docs/en-US.md): English user guide
- [docs/zh-CN.md](docs/zh-CN.md): Chinese user guide
- [CONTRIBUTING.md](CONTRIBUTING.md): contribution guide

## 10. Contributing

Contributions are welcome via issues, pull requests, and documentation improvements. See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## 11. License

MIT
