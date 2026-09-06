# Changelog

## 0.2.0 — 2026-09-06

- **feat(adapter)**: add custom model adapter registry and provider support
- **docs(changelog)**: update changelog for model adapter features

## 0.1.5 — 2026-09-02

- **fix(package)**: Support nested subpath exports in `package.json`.
- **fix(retrieval)**: Reduce phrase false negatives in retrieval scoring and document benchmark recall results.
- **fix(ci)**: Fix TS2345 type error in benchmark-recall evaluation.
- **docs**: Align README, architecture, and guides with actual GraphRAG implementation.
- **docs**: Add service usage, benchmark metrics, and comparison guidance.

## 0.1.3 — 2026-09-01

- **feat(package)**: Export submodule entrypoints (`input`, `namespace`, `retrieval`, `helper`, etc.).
- **fix(package)**: Rename npm package to `@ashes_born/graph-rag-ts`.
- **docs(contributing)**: Add Conventional Commits guidance and contribution workflow.

## 0.1.2 — 2026-09-01

- **ci**: Update npm release workflow and provenance configuration.

## 0.1.1 — 2026-09-01

- **chore**: Sync RAG engine implementation from upstream.
- **docs**: Translate repository documentation and codebase comments to English.
- **fix**: Restore test suite after translation cleanup.
- **ci**: Initialize npm publish GitHub Actions workflow.

## 0.1.0 — 2026-08-30

- Initial public release of the generated GraphRAG engine:
  - Markdown-aware ingestion: LLM-assisted slicing with deterministic fallback.
  - Leiden community detection via igraph WASM.
  - Hybrid retrieval (vector + keyword + graph reachability) with evidence-grounded answers.
  - Namespace-scoped multi-tenant data model.
  - Synthetic English sample corpus and an examples-based recall demo.
