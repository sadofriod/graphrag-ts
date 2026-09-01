# graphrag-ts English Guide

> This repository is maintained as a standalone project. It is developed directly in this codebase and is not generated from, or synchronized with, an upstream monorepo.

## 1. Project overview

`graphrag-ts` is a TypeScript-first GraphRAG reference implementation for Markdown corpora. It turns a collection of Markdown documents into a searchable knowledge graph and supports LLM-based chunking, deterministic fallback logic, graph construction, community detection, and hybrid retrieval.

Core capabilities:

- Markdown-aware chunking
- LLM-based slicing and summarization
- Entity, relationship, and claim graph construction
- Leiden community analysis
- Hybrid vector, keyword, and graph retrieval
- Evidence-grounded answer generation

## 2. Technology stack

- TypeScript
- Bun
- pnpm
- Prisma
- PostgreSQL + pgvector
- LangChain / OpenAI-compatible APIs

## 3. Installation

Use pnpm in this repository:

```bash
pnpm install
pnpm run db:generate
```

For local database setup:

```bash
cp .env.example .env
pnpm run db:push
```

## 4. Node module injection pattern

When this package is used as a Node module, the recommended approach is to inject runtime configuration through a single entry API instead of relying on repository-local files or implicit environment loading.

Example:

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

This keeps the runtime configuration external to the published package and makes the library portable across different application environments.

The Bun direct-run path remains supported for local development:

```bash
cp .env.example .env
pnpm install
pnpm run db:push
bun test
bun run examples/demo.ts
```

## 5. Required runtime parameters

After installation, the consumer application must provide the required runtime configuration before the GraphRAG pipeline can initialize.

Required items:

- `DATABASE_URL`
- `RAG_SLICE_*`
- `RAG_JUDGE_*`
- `RAG_EMBED_*`
- model config entries equivalent to `src/build/model.config.json`

Example environment:

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

Example runtime model config array:

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

## 6. Running tests and the demo

```bash
bun test
bun run examples/demo.ts
```

## 7. Contribution

Contributions are welcome. Please read:

- [README.md](../README.md)
- [CONTRIBUTING.md](../CONTRIBUTING.md)

## 8. License

MIT
