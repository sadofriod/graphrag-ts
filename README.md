# graphrag-ts

> TypeScript GraphRAG for Markdown corpora. Build a knowledge graph, detect communities, and answer with evidence-backed retrieval.

## Why this project exists

Traditional vector RAG is good at similarity search, but it is limited when you need cross-document structure, entity relationships, and global context. This repository implements a GraphRAG-style pipeline in TypeScript so you can index Markdown content and retrieve answers from a graph-backed knowledge base without a Python runtime or a custom product framework.

The project is designed for practical backend use:

- ingest Markdown files and split them into chunks
- extract entities, edges, and claims
- store graph data in PostgreSQL via Prisma
- detect communities and build community summaries
- fuse vector, keyword, and topology-based recall for retrieval
- generate answers from evidence instead of raw model output alone

## What it gives you

- a readable GraphRAG reference implementation in TypeScript
- database-backed persistence for entities, claims, edges, and communities
- namespace-aware builds for multi-tenant or multi-corpus usage
- hybrid retrieval that combines semantic, keyword, and graph signals
- deterministic fallback behavior when model-based chunking fails
- a small public API that is easy to embed in an application service

## Core pipeline

```mermaid
flowchart LR
    MD[Markdown files] --> SPLIT[Chunking and slicing]
    SPLIT --> GRAPH[Entity + edge + claim graph]
    GRAPH --> COMM[Community detection]
    COMM --> SUMMARY[Community summaries]
    Q[User query] --> INTENT[Intent parsing]
    INTENT --> HYBRID[Hybrid recall: vector + keyword + community]
    HYBRID --> EVIDENCE[Evidence aggregation]
    EVIDENCE --> ANSWER[Grounded answer]
```

The implementation matches this flow in the codebase:

- `src/build/` handles slicing, graph construction, and community detection
- `src/retrieval/` handles query parsing, ranking, evidence selection, and answer generation
- `prisma/schema.prisma` defines the persisted GraphRAG tables
- `src/index.ts` exposes the main runtime injection and public API

## Quick start

```bash
# install dependencies
pnpm install

# generate Prisma client
pnpm run db:generate

# copy environment variables
cp .env.example .env

# apply the schema
pnpm run db:push

# run tests
bun test

# run the demo
bun run examples/demo.ts
```

## Requirements

Before running the project, make sure you have:

- [pnpm](https://pnpm.io/) 10+
- [Bun](https://bun.sh) 1.1+
- PostgreSQL with [pgvector](https://github.com/pgvector/pgvector) enabled
- a chat model for slicing and judging
- an embedding model compatible with OpenAI-style APIs

## Runtime configuration

This repo expects configuration to be provided by the caller. The model loader reads environment variables from `src/build/modelLoader.ts`.

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
```

Typical runtime injection pattern:

```ts
import { PrismaClient } from '@prisma/client';
import {
  injectGraphRAG,
  GraphRAGRetrievalService,
  startBuild,
  createBuildRegistry,
} from '@ashes_born/graph-rag-ts';

await injectGraphRAG({
  database: {
    client: new PrismaClient({ datasourceUrl: process.env.DATABASE_URL }),
  },
  models: [
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
  ],
});

const registry = createBuildRegistry();
const buildId = startBuild(
  [{ title: 'sample.md', content: 'Alice works with Bob at Acme Corp.' }],
  registry,
  'demo-namespace',
);

const service = new GraphRAGRetrievalService();
const result = await service.retrieve({
  query: 'Who works with Alice?',
  topK: 5,
});

console.log(result.answer);
```

## Public API

This repo exposes a compact API surface that matches the implementation:

- `startBuild(...)`: starts an async build job and returns a build ID
- `createBuildRegistry()`: tracks build lifecycle state
- `GraphRAGRetrievalService`: executes hybrid retrieval and evidence-grounded answer generation
- `injectGraphRAG(...)`: injects Prisma, model config, and optional defaults
- `injectModelConfigs(...)`: initializes model adapters from config objects
- `injectPrismaClient(...)`: installs the shared Prisma client

Repository layout:

- `src/build/`: chunking, graph construction, community detection, registry
- `src/retrieval/`: query parsing, recall, ranking, evidence selection, answer generation
- `src/namespace/`: namespace scoping and isolation
- `src/config/`: default retrieval/build tuning values
- `examples/`: demo and benchmark scripts
- `docs/`: architecture and comparison notes

## Tuning and defaults

The project supports global runtime defaults via `injectGraphRAG(...)`, and request-level overrides via the `retrieve(...)` options object. The production defaults live in `src/config/defaults.ts`.

```ts
await injectGraphRAG({
  retrievalDefaults: {
    topK: 8,
    vectorChildTopK: 12,
    keywordSearchLimit: 24,
    evidenceChildLimit: 40,
    rrfK: 80,
  },
  buildDefaults: {
    maxChunkSize: 800,
    chunkOverlapRatio: 0.1,
  },
});
```

Example per-request tuning:

```ts
const result = await service.retrieve({
  query: 'Who is Irene Adler?',
  topK: 6,
  options: {
    vectorChildTopK: 20,
    keywordSearchLimit: 30,
    evidenceChildLimit: 50,
    rrfK: 80,
  },
});
```

These knobs control the retrieval window and ranking behavior:

- `topK`: community-level candidate count
- `vectorChildTopK`: child chunks returned by vector search
- `keywordSearchLimit`: keyword-matched child chunks
- `evidenceChildLimit`: evidence merge cap
- `rrfK`: reciprocal rank fusion sensitivity
- `maxChunkSize` and `chunkOverlapRatio`: deterministic chunking fallback

## Demo and benchmark

```bash
# demo build + retrieval
bun run examples/demo.ts

# benchmark recall metrics
bun run demo:benchmark
```

The benchmark script evaluates retrieval quality against generated Markdown corpora and reports real metrics for the persisted GraphRAG namespace. It is intended to validate the actual build and retrieval pipeline instead of relying on mocked behavior.

## Documentation

- [docs/architecture.md](docs/architecture.md): architecture and data flow
- [docs/en-US.md](docs/en-US.md): English user guide
- [docs/zh-CN.md](docs/zh-CN.md): Chinese user guide
- [docs/comparison.md](docs/comparison.md): comparison notes
- [CONTRIBUTING.md](CONTRIBUTING.md): contribution guide

## Contributing

Contributions are welcome through issues and pull requests. The project is organized around small, testable modules, so the most useful changes usually fit into one of these areas:

- graph construction quality
- retrieval quality and ranking
- namespace isolation
- model-loading robustness
- documentation and examples

## License

MIT
