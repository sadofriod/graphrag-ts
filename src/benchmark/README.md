# GraphRAG Recall Benchmark (Based on the "Retrospector" Outline)

Run recall benchmarks on GraphRAG retrieval via **HTTP API**. The data source is the "Retrospector" outline
(`volume1/2/3_stories.md` + `volume1_stories_details/` chapter structure),
see the dataset in [`dataset.ts`](./dataset.ts) (20 queries covering core facts across all three volumes' storylines).

## Principle

1. (Optional) Build a RAG index via `POST /api/rag/folders` using the outline folder, poll
   `GET /api/rag/builds/:buildId` until it succeeds.
2. Call `POST /api/rag/retrieve` for each query.
3. Concatenate retrieval results (hit community name/members/summary + evidence source sub-blocks) into context,
   compare against `expectation` (expected entities + expected key phrases), and calculate:

   - **Entity recall** = number of expected entities found in context / number of expected entities
   - **Information recall** = number of expected key phrases found / number of expected key phrases
   - **Combined recall** = merged recall of (entities + phrases)
   - **Strict hit** = all expectations appear

   By default, `answer` is **not** included (to avoid mixing LLM generation quality into retrieval recall);
   use `--include-answer` for an end-to-end metric.

## Prerequisites

- Backend service is running: `pnpm dev:services` (default `http://localhost:3000`)
- Database is available, embedding / LLM configuration is correct (building the index for the first time requires LLM to extract entities/edges/summaries)
- **Namespace**: default `default-namespace` (the namespace where the current data resides). If the index is built in another namespace, specify it with `--namespace`, otherwise retrieval is empty and recall is 0.

## Run

```bash
# Only run recall test on an existing index (do not rebuild)
bun run packages/services/rag/benchmark/run.ts

# Build index via API with the outline first, then run benchmark
bun run packages/services/rag/benchmark/run.ts --build

# Log each retrieval process (community/evidence counts, evidence snippet previews, recall values) to debug recall anomalies
bun run packages/services/rag/benchmark/run.ts --verbose

# Common parameters
--base-url http://localhost:3000   # Service URL (or RAG_API_BASE_URL)
--namespace default-namespace      # Namespace (or RAG_NAMESPACE)
--outline /path/to/outline             # Outline directory (or RAG_OUTLINE_PATH)
--topK 5                            # Unified recall window (overrides dataset default)
--include-answer                    # Include LLM answer in context (end-to-end metric)
--verbose                           # Print retrieval flow per query
```

The output is a Markdown report (total score, per-volume statistics, per-question details and missing items), which can be archived directly to compare iteration effects.

## Troubleshooting

- **Recall is all 0**: First confirm the namespace matches the index (where the data is, what `--namespace` points to). Then use `--verbose` to see the community/evidence counts and content returned for each query, to determine whether it is "no recall" or "recalled but the expected items are not in it".
- **retrieve returns 500**: Mostly due to a SQL error in the retrieval pipeline. Known issue: the `WITH RECURSIVE` in `communityResolver` previously used two recursive branches, and PG threw `42P19` (`recursive reference ... must not appear within its non-recursive term`); it has been changed to a single recursive branch.

## Unit Tests

```bash
pnpm --filter @novel-enginner/services test -- benchmark
```

`dataset.test.ts` validates, when the outline directory exists, whether expected entities/phrases appear **verbatim** in the outline source text, to prevent dataset/source document drift (skipped automatically if the directory is missing).

## Module Structure

| File | Responsibility |
|---|---|
| `dataset.ts` | Query + expectations (single data entry point) |
| `client.ts` | RAG HTTP API client (`fetch` injectable) |
| `context.ts` | Retrieval response → matchable context |
| `evaluate.ts` | Single-query recall evaluation |
| `report.ts` | Aggregated report (total score + per-volume) |
| `format.ts` | Report → Markdown |
| `build.ts` | Build index + poll and wait |
| `run.ts` | Orchestration + CLI entry point |
