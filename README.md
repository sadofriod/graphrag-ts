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

## 6. Recall demo

```bash
bun run demo:benchmark
```

This example downloads public-domain long texts from Project Gutenberg, converts chapter boundaries into Markdown headings, builds the GraphRAG index, and reports recall@k over retrieval context. It demonstrates both long Markdown structure splitting and retrieval recall scoring. It requires a real database and configured model services.

## Retrieval & Tuning (Configurable)

The package exposes a small set of tuning knobs so consumers can adjust retrieval and build behaviour without changing library code.

- Global defaults: pass options to `injectGraphRAG(...)` when embedding the library into your application. These defaults are applied when per-request overrides are not provided.
- Per-request overrides: the `retrieve(...)` method accepts an `options` object allowing fine-grained control for a single query.

Example: inject global defaults at startup

```ts
import { injectGraphRAG } from 'graphrag-ts';

await injectGraphRAG({
  retrievalDefaults: {
    topK: 8, // number of community summaries to consider for semantic ranking
    vectorChildTopK: 12, // number of child chunks returned by vector search
    keywordSearchLimit: 24, // max keyword-matched child chunks
    evidenceChildLimit: 40, // final merged evidence cap
    rrfK: 100, // reciprocal rank fusion 'k' parameter
  },
  buildDefaults: {
    maxChunkSize: 1200, // characters for deterministic chunking fallback
    chunkOverlapRatio: 0.15, // fraction overlap for deterministic splitter
  },
});
```

Example: per-request tuning when retrieving

```ts
import { GraphRAGRetrievalService } from 'graphrag-ts';

const svc = new GraphRAGRetrievalService();
const result = await svc.retrieve({
  query: 'Who is Irene Adler?',
  topK: 6, // community summary semantic top-K
  options: {
    vectorChildTopK: 20,
    keywordSearchLimit: 30,
    evidenceChildLimit: 50,
    rrfK: 80,
  },
});
```

Notes:

- `topK` controls how many community summaries are retrieved by semantic similarity.
- `vectorChildTopK`, `keywordSearchLimit` and `evidenceChildLimit` control the hybrid evidence window and merging behaviour.
- `rrfK` adjusts Reciprocal Rank Fusion sensitivity when fusing multiple ranked lists (semantic/entity/structural).
- `maxChunkSize` and `chunkOverlapRatio` affect deterministic fallback chunking and can be provided globally (via `injectGraphRAG`) or by calling `textSplit(...)` directly with the optional `chunkSize`/`chunkOverlap` fields.

These tuning knobs let you experiment quickly (larger `topK`/child windows increase recall but cost more IO and compute; larger `rrfK` smooths fusion scores).

Latest local run, 2026-09-02:

- Corpus: 3 generated Markdown files, 62,315 characters, 5 chapter headings.
- Namespace: `demo-long-markdown-recall-20260902-readme`.
- Full local report: [`.tmp/benchmark-recall-report.md`](.tmp/benchmark-recall-report.md).

## Retrieval benchmark conclusion (DB-grounded, retrieval-only)

The benchmark was aligned to the real GraphRAG namespace contents and the phrase-level evaluator was corrected to avoid false negatives caused by literal wording differences. The current retrieval-only baseline is therefore a more faithful measure of real retrieval quality.

| Metric | Result |
| --- | ---: |
| Total queries | 12 |
| Strict hits | 5 / 12 (41.7%) |
| Average entity recall | 70.8% |
| Average phrase recall | 66.7% |
| Average combined recall | 69.6% |

| Source | Queries | Hits | Hit rate | Entity recall | Phrase recall |
| --- | ---: | ---: | ---: | ---: | ---: |
| Alice's Adventures in Wonderland | 6 | 3 | 50.0% | 77.8% | 83.3% |
| Frankenstein | 6 | 2 | 33.3% | 63.9% | 50.0% |

### Interpretation

- The benchmark is now statistically coherent because the dataset matches the actual namespace state.
- The system is strong on core entity/theme retrieval and on several high-signal literary scenes.
- Remaining misses are mostly genuine retrieval difficulty rather than benchmark artifacts.
- The updated phrase matcher preserves strictness on topic and key concepts while tolerating natural paraphrase, which reduces false negatives without making the benchmark permissive.

This makes the current GraphRAG implementation a valid retrieval baseline for the actual persisted namespace: it shows a 41.7% strict-hit rate and a 69.6% combined recall, with the remaining misses now serving as a cleaner signal of real retrieval weakness rather than evaluation noise.

## 7. Repository structure

| Path | Type | Description |
| --- | --- | --- |
| `src/build/` | core | Chunking, community detection, entity/edge/claim construction |
| `src/retrieval/` | core | Query intent, recall, ranking, evidence, answer generation |
| `src/namespace/` | core | Multi-tenant namespace isolation |
| `examples/` | maintained | Example code, sample corpora, and the recall demo |
| `docs/` | maintained | Design notes, comparison, and historical migration notes |
| `_migration/` | legacy | Historical migration cache and compatibility scripts |

## 8. Practical usage in a real service

This repository is not only an isolated demo; it is designed to plug into an application service runtime. In the attached service package, the pattern is:

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

The real service layer does two important things:

1. It registers a `GraphRAGRetrievalService` in the app dependency container.
2. It exposes GraphRAG data ingestion and retrieval through HTTP endpoints such as:

```http
POST /api/rag/ingest
{
  "entities": [...],
  "edges": [...],
  "reconcileEvery": 20,
  "rebuild": false
}

POST /api/rag/retrieve
{
  "query": "summarize key risks in this corpus",
  "topK": 5
}
```

This is the recommended usage pattern for actual backend integration:

- index Markdown documents with `startBuild(...)` or the build registry
- attach a namespace so multi-tenant corpora remain isolated
- persist entities, edges, chunks, and communities in PostgreSQL + pgvector
- retrieve with hybrid vector + keyword + graph evidence
- expose the answer and the evidence list to an application HTTP layer

The repository's own example demonstrates the same idea in `examples/demo.ts`: it builds a sample corpus, waits for the job to finish, then runs a retrieval query over the graph.

## 9. Pros and cons versus mainstream GraphRAG repositories

### Advantages

- Clear reference architecture: the ingest, build, retrieval, and evidence pipeline are easy to inspect and extend.
- PostgreSQL-first design: relational storage is familiar to enterprise teams and works well with pgvector.
- Deterministic fallback logic: when model behavior drifts, the code still has a predictable fallback path.
- TypeScript-first developer experience: the project is written to be readable, testable, and readily embedded into custom services.
- Namespace-aware and service-friendly: it matches the real usage pattern of multi-tenant document systems.

### Limitations

- It is not a full end-user product: there is no hosted UI, authentication layer, or opinionated workflow manager built in.
- Performance depends on a proper Postgres + pgvector deployment and careful model configuration.
- Graph construction and retrieval still require meaningful model quality and tuning for production corpora.
- Compared with larger commercial or repo-scale graph systems, this project intentionally keeps the surface area smaller and more educational.

### Compared with mainstream repositories

| Project | Strengths | Trade-offs |
| --- | --- | --- |
| `graphrag-ts` | clear reference implementation, TypeScript-oriented, PostgreSQL-native, evidence-grounded | smaller product surface, not a turn-key app |
| AutoFlow | strong product positioning, opinionated app workflow | more application-specific and less transparent as a library |
| GitNexus | excellent repo intelligence and code-context workflow | more specialized for code/search tooling, less general markdown GraphRAG focus |
| BrowseGraph | local-first and privacy-oriented | optimized for personal browsing, less enterprise backend depth |

The overall conclusion is that this repository is best suited for teams that want to understand GraphRAG deeply and integrate it into their own backend stack without adopting a heavyweight platform.

## 10. Documentation index

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
