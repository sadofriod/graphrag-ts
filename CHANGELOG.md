# Changelog

## Unreleased

- **feat(adapter)**: Add custom model adapter registry and provider support.
  - Pluggable LangChain model adapter layer supporting custom Chat and Embedding providers (e.g. Anthropic, Ollama, Google GenAI).
  - Configurable providers via environment variables (`RAG_SLICE_PROVIDER`, `RAG_JUDGE_PROVIDER`, `RAG_EMBED_PROVIDER`).
  - Exported adapter registration and resolution APIs: `registerChatAdapter`, `registerEmbeddingAdapter`, `resolveChatAdapter`, `resolveEmbeddingAdapter`, and `resetAdapters`.
- **refactor(retrieval)**: Centralize and normalize retrieval options parsing with fallback logic in `GraphRAGRetrievalService`.
- **perf(build)**: Optimize batch community summary persistence and LLM JSON parsing robustness.
- **docs**: Add custom model adapter usage examples and configuration documentation in English and Chinese.

## 0.1.0 — 2026-08-30

- Initial public release of the generated GraphRAG engine:
  - Markdown-aware ingestion: LLM-assisted slicing with deterministic fallback.
  - Leiden community detection via igraph WASM.
  - Hybrid retrieval (vector + keyword + graph reachability) with evidence-grounded answers.
  - Namespace-scoped multi-tenant data model.
  - Synthetic English sample corpus and an examples-based recall demo.
