# graphrag-ts

A reference implementation of a chunked **GraphRAG** engine in TypeScript (Bun).
It turns a folder of markdown into a retrievable knowledge graph: LLM-assisted
slicing with deterministic fallback, Leiden community detection, entity/claim
graph construction, and a hybrid (vector + keyword) retrieval pipeline with
evidence-grounded answer generation.

> This repository is **generated** from the rag module of a larger project. The
> code under `src/` is automatically synced by a migration pipeline; everything
> else (this README, `docs/`, `examples/`) is hand-maintained. See
> [docs/architecture.md](docs/architecture.md) for the design and
> [docs/migration.md](docs/migration.md) for how the sync works.

## Requirements

- [Bun](https://bun.sh) 1.1+
- A PostgreSQL database with the [pgvector](https://github.com/pgvector/pgvector) extension
- Two LLM endpoints: a chat model (DeepSeek-compatible, JSON mode) and an
  embedding model (OpenAI-compatible API, e.g. LM Studio)

## Quick start

```bash
# 1. Install dependencies and generate the Prisma client
bun install
bun run db:generate

# 2. Configure models (copy and fill in)
cp .env.example .env
#   RAG_SLICE_API_KEY=...      # chat model for slicing / summaries / answers
#   RAG_JUDGE_API_KEY=...      # chat model for judging (can share the slice key)
#   RAG_EMBED_API_KEY=...      # embedding model (e.g. LM Studio: sk-anything)
#   DATABASE_URL=postgresql://user:pass@localhost:5432/graphrag

# 3. Create the schema
bun run db:push

# 4. Run the unit tests (no live DB or LLM needed)
bun test

# 5. Run the end-to-end demo against the sample corpus
bun run examples/demo.ts
```

## Running the benchmark

The recall benchmark exercises the whole pipeline over the synthetic sample
corpus (`examples/sample-corpus/`). It needs a live database and configured
models:

```bash
bun run benchmark --build --base-url http://localhost:3000
```

## Repository layout

| Path | Owner | Purpose |
| --- | --- | --- |
| `src/build/` | generated | ingestion: slicing, community detection, entity/claim building |
| `src/retrieval/` | generated | retrieval: query intent, recall, ranking, evidence, answer |
| `src/benchmark/` | generated | recall benchmark (dataset, client, evaluate, report) |
| `src/namespace/` | generated | multi-tenant namespace scoping |
| `examples/` | hand-maintained | runnable demo + sample corpus |
| `docs/` | hand-maintained | architecture and migration docs |
| `_migration/` | script-owned | translation cache for the sync pipeline |

## License

MIT
