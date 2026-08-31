# Comparison with mainstream TypeScript GraphRAG projects

`graphrag-ts` is a focused reference implementation: it emphasizes a compact TypeScript codebase, PostgreSQL + pgvector storage, deterministic fallbacks, and evidence-grounded retrieval. The projects below target different operating models in the broader TypeScript GraphRAG ecosystem.

## Scope of the comparison

This comparison focuses on TypeScript or TypeScript-first open-source projects that are commonly used as reference points for GraphRAG-style systems:

- [pingcap/autoflow](https://github.com/pingcap/autoflow)
- [abhigyanpatwari/GitNexus](https://github.com/abhigyanpatwari/GitNexus)
- [talperetz/browsegraph](https://github.com/talperetz/browsegraph)

Repository descriptions and READMEs were used as the basis for the comparison.

## High-level comparison

| Project | Primary use case | Storage model | Retrieval style | Deployment posture |
| --- | --- | --- | --- | --- |
| `graphrag-ts` | Reference GraphRAG engine for markdown corpora | PostgreSQL + pgvector + relational `rag_*` tables | Hybrid vector + keyword + graph reachability | Library-style, developer-operated |
| AutoFlow | Conversational knowledge base and search product | TiDB vector storage and app-managed metadata | GraphRAG-style KB retrieval for hosted search | Product/application oriented |
| GitNexus | Code intelligence and agent context for repositories | LadybugDB (native/WASM) knowledge graph storage | Precomputed graph/tool-driven retrieval | CLI, MCP, and browser workflows |
| BrowseGraph | In-browser personal knowledge graph from browsing | Browser-local pglite + pgvector | Local retrieval over summarized browsing data | Chrome extension / local-first |

## Where `graphrag-ts` is different

### 1. Reference implementation instead of end-user product

Unlike AutoFlow and BrowseGraph, this repository is not a full hosted application or browser product. It keeps the core ingestion and retrieval pipeline small and inspectable so teams can adapt it to their own services.

### 2. PostgreSQL-native data model

`graphrag-ts` stores chunks, entities, edges, communities, and claims in relational tables backed by pgvector. That makes the pipeline easy to integrate into existing Postgres-heavy stacks. By contrast:

- AutoFlow centers on TiDB and a broader application stack.
- GitNexus uses a purpose-built graph/indexing engine for code intelligence.
- BrowseGraph keeps storage in the browser for local-first usage.

### 3. Hybrid retrieval with explicit evidence assembly

This project combines three retrieval channels in the core pipeline:

- vector similarity over child chunks
- keyword recall for exact fact phrases
- graph/community expansion for relationship-aware recall

It then assembles bounded evidence before answer generation. GitNexus also leans heavily on graph structure, but through precomputed tools for code analysis rather than a markdown knowledge-base pipeline. BrowseGraph focuses on summarization and local search over browsing history.

### 4. Deterministic fallback behavior

A notable design choice here is that LLM-assisted slicing and summarization always have deterministic fallbacks. That makes the reference implementation easier to reason about, test, and operate when model output quality is uneven.

## When to choose `graphrag-ts`

Choose this project when you want:

- a TypeScript-first GraphRAG reference you can embed into your own backend
- a markdown-to-knowledge-graph pipeline with clear module boundaries
- PostgreSQL/pgvector compatibility instead of a custom graph platform
- unit-testable retrieval logic with limited framework lock-in

You may prefer the alternatives when you want:

- a more complete end-user knowledge-base product (AutoFlow)
- repo-scale code intelligence and MCP tooling (GitNexus)
- a browser-native, privacy-preserving personal knowledge graph (BrowseGraph)

## Summary

`graphrag-ts` aims to be easier to study, fork, and integrate than the larger TypeScript GraphRAG products around it. Its main trade-off is that it intentionally provides a smaller surface area: you get the core pipeline, not a full application platform.
