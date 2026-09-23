# Changelog

## 0.1.8 — 2026-09-23

- **feat(build)**: Add incremental GraphRAG write and differential graph maintenance.
- **feat(adapter)**: add custom model adapter registry and provider support
- **fix**: address community detection review feedback
- **fix(community-summary)**: refresh summaries when inputs change
- **fix(ci)**: avoid DATABASE_URL lookup during prisma generate
- **fix**: fix persisted edge counts and community namespace guard
- **fix(release)**: align 0.1.6 version from npm base and update bump script
- **docs**: note nullable legacy fingerprints
- **docs**: soften fingerprint schema contract
- **docs**: clarify community fingerprint format
- **docs**: note runtime fingerprint backfill behavior
- **docs**: add local demo
- **docs(changelog)**: update changelog for model adapter features
- **chore**: match prisma lockfile format
- **chore**: add prisma migration metadata
- **test**: scope retrieval claim overrides by id
- **test**: allow empty retrieval mock overrides
- **test**: cover claim-only summary refresh regression
- **ci**: automate changelog generation and version bump in CI workflow
- Merge pull request #5 from sadofriod/fix/community-summary-fingerprint
- Merge pull request #3 from sadofriod/feat/complete-incremental-write
- fix ci error
- fix type and lint err
- Use Bun hashing in document diff
- Fix incremental review feedback
- export incremetal apis

## 0.1.8 — 2026-09-23

- **feat(build)**: Add incremental GraphRAG write and differential graph maintenance.
- **feat(adapter)**: add custom model adapter registry and provider support
- **fix(ci)**: avoid DATABASE_URL lookup during prisma generate
- **fix**: fix persisted edge counts and community namespace guard
- **fix(release)**: align 0.1.6 version from npm base and update bump script
- **docs**: add local demo
- **docs(changelog)**: update changelog for model adapter features
- **ci**: automate changelog generation and version bump in CI workflow
- Merge pull request #3 from sadofriod/feat/complete-incremental-write
- fix ci error
- fix type and lint err
- Use Bun hashing in document diff
- Fix incremental review feedback
- export incremetal apis

## 0.1.7 — 2026-09-22

- **feat(build)**: Add incremental GraphRAG write and differential graph maintenance.
- **feat(adapter)**: add custom model adapter registry and provider support
- **fix(ci)**: avoid DATABASE_URL lookup during prisma generate
- **fix**: fix persisted edge counts and community namespace guard
- **fix(release)**: align 0.1.6 version from npm base and update bump script
- **docs(changelog)**: update changelog for model adapter features
- **ci**: automate changelog generation and version bump in CI workflow
- Merge pull request #3 from sadofriod/feat/complete-incremental-write
- fix ci error
- fix type and lint err
- Use Bun hashing in document diff
- Fix incremental review feedback
- export incremetal apis

## 0.1.7 — 2026-09-14

- **feat(build)**: Add incremental GraphRAG write and differential graph maintenance.
  - **Document Change Detection**: Implemented `diffDocuments` with SHA-256 content hashing to classify input files into `insert`, `update`, and `skip`, enabling early short-circuiting when files are unchanged.
  - **Cascade Document Pruning**: Added `deleteDocumentByTitle`, `deleteDocumentByParentId`, and `pruneStaleDocuments` to remove stale parent chunks, child embeddings, and associated claims upon document updates or explicit deletions.
  - **Differential Community Summary Updates**: Implemented topological fingerprinting (`computeCommunityFingerprint`) and differential persistence (`persistCommunitySummaries`) to reuse unchanged community summaries and embeddings at zero LLM cost while automatically pruning obsolete summaries.
  - **Public Incremental APIs**: Added `buildIncrementalRAG`, `startIncrementalBuild`, `deleteRAGDocument`, and enriched `BuildSummary` metrics with `insertedFiles`, `updatedFiles`, and `skippedFiles`.
- **docs**: Updated architecture diagrams and English/Chinese guides with incremental build instructions.

## 0.1.6 — 2026-09-06

- **feat(adapter)**: add custom model adapter registry and provider support
- **fix(release)**: align 0.1.6 version from npm base and update bump script
- **docs(changelog)**: update changelog for model adapter features
- **ci**: automate changelog generation and version bump in CI workflow

## 0.1.6 — 2026-09-06

- **feat(adapter)**: Add custom model adapter registry and provider support.
  - Pluggable LangChain model adapter layer supporting custom Chat and Embedding providers (e.g. Anthropic, Ollama, Google GenAI).
  - Configurable providers via environment variables (`RAG_SLICE_PROVIDER`, `RAG_JUDGE_PROVIDER`, `RAG_EMBED_PROVIDER`).
  - Exported adapter registration and resolution APIs: `registerChatAdapter`, `registerEmbeddingAdapter`, `resolveChatAdapter`, `resolveEmbeddingAdapter`, and `resetAdapters`.
- **refactor(retrieval)**: Centralize and normalize retrieval options parsing with fallback logic in `GraphRAGRetrievalService`.
- **perf(build)**: Optimize batch community summary persistence and LLM JSON parsing robustness.
- **docs**: Add custom model adapter usage examples and configuration documentation in English and Chinese.
- **ci**: Automate CHANGELOG extraction from git log and version bumping based on npm published version.

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
