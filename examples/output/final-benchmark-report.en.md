# GraphRAG MCP Benchmark Report

Baseline run date: 2026-10-11\
Baseline runtime: Docker Compose with PostgreSQL/pgvector and the MCP HTTP service; queries run through the MCP `query_graph` tool.\
Baseline models: DeepSeek API `deepseek-v4-flash` for slicing and judging; LM Studio `text-embedding-nomic-embed-text-v1.5` for 768-dimensional embeddings.

## Results at a Glance

| Scenario | Coverage | Result |
|---|---|---|
| In-corpus retrieval | 5 chapters, 12 queries | 10/12 strict hits (83.3%); 95.8% combined recall; 22.5s average query latency; about 12m 19s to index |
| Global Map Reduce (after fixes) | 2 cross-community queries | Map entity/phrase recall was 100% on both; final Reduce combined recall was 80% and 100% |
| Incremental update | Updated one Alice document, then queried the new fact | Combined recall rose from 50% to 100%; incremental build took about 5m 11s |

**How to read these results:** The 12-query baseline and the October 12 workflow follow-up used different models and runtimes, so they are not a model comparison. Recall uses lexical entity and ordered-phrase matching, not human semantic grading. The Global Map Reduce section below includes both pre-fix and post-fix results, plus the remaining cross-batch conflict.

## Corpus and Baseline Setup

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

## Global Map Reduce and Incremental Update Follow-up

Date: 2026-10-12. This follow-up ran against a cloned benchmark database and an isolated namespace, leaving the active index unchanged. The corpus used the indexed Alice and Frankenstein documents. LM Studio `google/gemma-4-12b` was used for slicing/judging, and `text-embedding-nomic-embed-text-v1.5` for embeddings. These results use a different model and runtime from the 2026-10-11 DeepSeek/MCP baseline above and should not be compared as a controlled model comparison.

### Global Map Reduce

The following is the historical pre-fix baseline. It read only level-0 community summaries and did not pass leaf-assigned claims or source chunks to Map. The expected phrase `wretchedness and despair` is not present in this indexed corpus.

| id | Status | Map answers | Failed batches | Entity recall | Phrase recall | Missing entities | Missing phrases |
|---|---|:---:|:---:|:---:|:---:|---|---|
| global-alice-creature-learning | completed | 1 | 0 | 67% | 0% | De Lacey | three little sisters, articulate sounds |
| global-victor-creation-cost | completed | 1 | 0 | 100% | 0% | - | dull yellow eye, wretchedness and despair |

Both queries completed the Map/Reduce workflow, but successful execution alone does not mean the expected facts were recalled.

#### After Leaf and Evidence Changes

The rerun selected terminal leaf communities by default and supplied their assigned claims and original source chunks to Map. MCP `query_graph_global` now accepts `community_level: "leaf"` or a non-negative integer for an exact level. The benchmark expectations no longer include phrases absent from the index, and recall is reported separately for Map intermediate answers and final Reduce answers.

| id | Status | Map answers | Failed batches | Map entity recall | Map phrase recall | Final entity recall | Final phrase recall | Missing final entities | Missing final phrases |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|---|---|
| global-alice-creature-learning | completed | 5 | 0 | 100% | 100% | 100% | 50% | - | articulate sounds |
| global-victor-creation-cost | completed | 3 | 0 | 100% | 100% | 100% | 100% | - | - |

Leaf evidence brought Map recall to 100% on both cases. Reduce preserved 100% recall for Victor and 80% combined recall for Alice/Creature. Map batches disagreed about whether the Dormouse tells the three-sisters story; Reduce repeated both the claim and the conflicting limitation. The final answer retained “three little sisters” but omitted “articulate sounds.” Cross-batch conflict handling remains a limitation. These are lexical recall results, not semantic grading.

### Incremental Update

The benchmark appended this fact to `alice-adventures-in-wonderland.md`: “Alice keeps a silver compass in the west observatory as part of the new archive.” It then incrementally rebuilt the index and queried, “What does Alice keep in the west observatory?”

| Stage | Entity recall | Phrase recall | Combined recall | Strict hit | Missing entities | Missing phrases |
|---|---:|---:|---:|:---:|---|---|
| Before update | 50% | 50% | 50% | no | silver compass | new archive |
| After incremental update | 100% | 100% | 100% | yes | - | - |

| Metric | Result |
|---|---:|
| Build mode | incremental |
| Updated file | alice-adventures-in-wonderland.md |
| Incremental build duration | 310,667 ms (5m 10.7s) |

Before the update, retrieval already found Alice and “west observatory,” giving a 50% baseline. Afterward, it also found “silver compass” and “new archive.” This tests recall of a new fact after updating one document; it is not a measurement of full-corpus incremental throughput.

## Start the Docker Benchmark Within Five Minutes

The five-minute target means that, with Docker installed, model and connection settings configured, and chat plus 768-dimensional embedding models ready, the Compose services become ready and the MCP indexing benchmark job starts. **It does not mean the complete index and all queries finish within five minutes.** Model downloads/loads and machine/network variation are outside the target.

From the repository root, copy `.env.example` to `.env`, set `POSTGRES_PASSWORD` and its URL-encoded counterpart, and configure slice, judge, and embedding endpoints reachable from Docker. Then run:

```bash
pnpm benchmark:docker:quick
```

The command builds and waits for Docker Compose, mounts `examples/quickstart-corpus`, submits the index job through MCP, and begins the three-question quick benchmark. The runner executes inside the MCP container, so host-side Bun workspace dependencies are not needed. The quick corpus is above the deterministic-split threshold and exercises LLM graph extraction. It checks Docker startup, model connectivity, MCP indexing, and query execution; it does not replace the full 12-question benchmark.

The evaluator matches entities and ordered phrases; it is not human semantic grading. The two strict misses need to be interpreted against the item wording and source evidence: one expects Elizabeth for a Chapter 5 question, and one expects the phrase “on horseback” while the generated answer uses equivalent wording. These results describe this corpus and model configuration and are not a cross-project ranking.
