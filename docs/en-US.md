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

## 6.1 Current benchmark conclusion

The current GraphRAG retrieval benchmark was run in retrieval-only mode against the persisted GraphRAG namespace after aligning the dataset to the actual database state. The phrase-level evaluator was also updated to reduce false negatives caused by natural paraphrase and quotation differences.

| Metric | Result |
| --- | ---: |
| Total queries | 12 |
| Strict hits | 5 / 12 (41.7%) |
| Average entity recall | 70.8% |
| Average phrase recall | 66.7% |
| Average combined recall | 69.6% |

The result is a valid baseline for the real namespace: the system is strong on theme/entity retrieval and on several high-signal narrative scenes, while the remaining misses mostly reflect real retrieval difficulty rather than benchmark drift or wording artifacts. In other words, the implementation is usable as a memory/retrieval layer, but it still needs further work on long-range factual grounding and scene-specific retrieval for the hardest questions.

## 7. Concrete service usage pattern

This repository is meant to be used as a backend GraphRAG engine rather than as an isolated script. The real integration flow in the service layer is:

```ts
import { createAppDeps } from '@novel-enginner/services/api/deps';

const deps = createAppDeps();

const buildId = deps.enqueueBuild(files, 'novel-demo');
const result = await deps.retrieval.retrieve({
  query: 'What does the limited reset actually shut down?',
  topK: 5,
});

console.log(result.answer);
```

The service package does the following:

- creates a database-backed build registry
- injects a `GraphRAGRetrievalService`
- starts asynchronous build jobs with `startBuild(...)`
- exposes ingestion and retrieval via HTTP routes

The ingestion route is aligned with the GraphRAG workflow:

```http
POST /api/rag/ingest
{
  "entities": [...],
  "edges": [...],
  "reconcileEvery": 20,
  "rebuild": false
}
```

The retrieval route follows the same pattern:

```http
POST /api/rag/retrieve
{
  "query": "summarize the core risks in this corpus",
  "topK": 5
}
```

This means the library is meant to be used as a backend service where the application owns:

- corpus upload and scheduling
- namespace isolation
- GraphRAG indexing jobs
- final answer assembly based on evidence

## 8. Why this project is useful

### Strengths

- strong separation of indexing and retrieval concerns
- deterministic fallbacks when model output is unstable
- PostgreSQL + pgvector compatibility for enterprise environments
- understandable modules for custom extension

### Trade-offs

- not a ready-made SaaS or UI product
- requires real model configuration and a working Postgres deployment
- more educational and extensible than monolithic or product-focused GraphRAG apps

## 9. Comparison with mainstream GraphRAG repos

| Project | Best fit | Main trade-off |
| --- | --- | --- |
| `graphrag-ts` | reference engine and backend integration | not a complete product experience |
| AutoFlow | product-driven knowledge base | heavier application assumptions |
| GitNexus | code intelligence and repo knowledge retrieval | narrower domain scope |
| BrowseGraph | local, browser-first knowledge graphs | less enterprise backend depth |

In short, `graphrag-ts` is a good choice when you want a readable GraphRAG implementation that can be adapted into your own service stack, but it intentionally does not try to become a full hosted knowledge app.

## 10. Contribution

Contributions are welcome. Please read:

- [README.md](../README.md)
- [CONTRIBUTING.md](../CONTRIBUTING.md)

## 11. License

MIT
