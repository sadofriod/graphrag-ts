# GraphRAG MCP Benchmark Report

Date: 2026-10-11\
Runtime: Docker Compose with PostgreSQL/pgvector and the MCP HTTP service; queries run through the MCP `query_graph` tool.\
Models: DeepSeek API `deepseek-v4-flash` for slicing and judging; LM Studio `text-embedding-nomic-embed-text-v1.5` for 768-dimensional embeddings.

## Corpus Scope

The mounted corpus contains only these sections:

- *Alice's Adventures in Wonderland*: Chapters I and VII
- *Frankenstein*: Chapters 5, 12, and 13

## In-Corpus Recall

After indexing the corpus, all 12 questions grounded in the included sections ran through Docker MCP `query_graph`. Indexing took about 12m 19s.

| Metric | Result |
|---|---:|
| Queries | 12 |
| Strict hits | 10 / 12 (83.3%) |
| Average entity recall | 95.8% |
| Average phrase recall | 95.8% |
| Average combined recall | 95.8% |
| Average query latency | 22,513 ms |

| Source | Queries | Hits | Hit rate | Entity recall | Phrase recall |
|---|:---:|:---:|:---:|:---:|:---:|
| Alice's Adventures in Wonderland | 7 | 7 | 100.0% | 100.0% | 100.0% |
| Frankenstein | 5 | 3 | 60.0% | 90.0% | 90.0% |

| id | Source | Focus | Hit | Entity recall | Phrase recall | Missing entities | Missing phrases |
|---|---|---|:---:|:---:|:---:|---|---|
| corpus-alice-rabbit-watch | Alice's Adventures in Wonderland | chapter I rabbit watch | yes | 100% | 100% | - | - |
| corpus-alice-marmalade-jar | Alice's Adventures in Wonderland | chapter I falling jar | yes | 100% | 100% | - | - |
| corpus-alice-rabbit-eyes | Alice's Adventures in Wonderland | chapter I rabbit appearance | yes | 100% | 100% | - | - |
| corpus-alice-tea-party-guests | Alice's Adventures in Wonderland | chapter VII tea party guests | yes | 100% | 100% | - | - |
| corpus-alice-no-wine | Alice's Adventures in Wonderland | chapter VII tea offer | yes | 100% | 100% | - | - |
| corpus-alice-hatter-riddle | Alice's Adventures in Wonderland | chapter VII raven riddle | yes | 100% | 100% | - | - |
| corpus-alice-dormouse-story | Alice's Adventures in Wonderland | chapter VII Dormouse story | yes | 100% | 100% | - | - |
| corpus-frankenstein-creation-eye | Frankenstein | chapter 5 creature awakens | yes | 100% | 100% | - | - |
| corpus-frankenstein-victor-reaction | Frankenstein | chapter 5 Victor flees | no | 50% | 100% | Elizabeth | - |
| corpus-frankenstein-clerval-arrival | Frankenstein | chapter 5 Clerval arrives | yes | 100% | 100% | - | - |
| corpus-frankenstein-cottage-words | Frankenstein | chapter 12 creature learns words | yes | 100% | 100% | - | - |
| corpus-frankenstein-safie-arrives | Frankenstein | chapter 13 Safie arrives | no | 100% | 50% | - | on horseback |

## Per-Section Graph Counts

Persisted counts for each indexed section are below. Child chunks include graph-extraction chunks and verbatim source chunks; claims and edges are grouped by parent.

| Indexed section | Child chunks | Claims | Edges |
|---|---:|---:|---:|
| Alice Chapter I | 83 | 45 | 36 |
| Alice Chapter VII | 83 | 45 | 35 |
| Frankenstein Chapter 5 | 87 | 58 | 21 |
| Frankenstein Chapter 12 | 90 | 57 | 33 |
| Frankenstein Chapter 13 | 88 | 56 | 41 |

Edge counts differ by section; counts describe graph size, not graph or retrieval quality by themselves. Graph quality also requires entity/relation accuracy, evidence coverage, and manual review.

## Start the Docker Benchmark Within Five Minutes

The five-minute target means that, with Docker installed, model and connection settings configured, and chat plus 768-dimensional embedding models ready, the Compose services become ready and the MCP indexing benchmark job starts. **It does not mean the complete index and all queries finish within five minutes.** Model downloads/loads and machine/network variation are outside the target.

From the repository root, copy `.env.example` to `.env`, set `POSTGRES_PASSWORD` and its URL-encoded counterpart, and configure slice, judge, and embedding endpoints reachable from Docker. Then run:

```bash
pnpm benchmark:docker:quick
```

The command builds and waits for Docker Compose, mounts `examples/quickstart-corpus`, submits the index job through MCP, and begins the three-question quick benchmark. The runner executes inside the MCP container, so host-side Bun workspace dependencies are not needed. The quick corpus is above the deterministic-split threshold and exercises LLM graph extraction. It checks Docker startup, model connectivity, MCP indexing, and query execution; it does not replace the full 12-question benchmark.

The evaluator matches entities and ordered phrases; it is not human semantic grading. The two strict misses need to be interpreted against the item wording and source evidence: one expects Elizabeth for a Chapter 5 question, and one expects the phrase “on horseback” while the generated answer uses equivalent wording. These results describe this corpus and model configuration and are not a cross-project ranking.
