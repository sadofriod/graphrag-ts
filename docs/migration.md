# Migration pipeline

The code under `src/` is **generated** from the rag module of a larger monorepo by
a migration script. This document explains how that works so maintainers know
what is safe to edit by hand.

## How the sync works

On every push to `main` of the source repository, a GitHub Actions workflow runs:

1. **Copy** — the rag source tree is copied into a staging area. The committed
   `model.config.json` (which contains a real API key) is excluded.
2. **Patch** — a handful of files are structurally rewritten for the public repo:
   - `modelLoader.ts` reads config from env vars instead of a JSON file.
   - `llmCallbacks.ts` drops the internal job-context (ALS) correlation.
   - `dbBuildRegistry.ts` is removed (the OSS repo uses the in-memory registry).
   - the benchmark dataset is replaced with a synthetic English one.
3. **Rewrite imports** — the monorepo aliases (`@rag/*`, `@helper/logger`) are
   rewritten to self-contained relative paths.
4. **Translate** — Chinese text in comments, strings, and prompt markdown is
   translated to English via a DeepSeek API call. Results are cached by content
   hash in `_migration/cache.json`, so only changed files are re-translated.
5. **Generate** — `package.json`, `tsconfig.json`, `.env.example`, the MIT
   `LICENSE`, the Prisma schema, and the baseline migration are regenerated.
6. **Sync & test** — the generated `src/` and support files are written into the
   OSS repo working copy, then `bun test` runs against them.
7. **Push** — changes are committed and pushed to this repository.

## What is safe to edit by hand

- `README.md`, `docs/`, `examples/`, `CHANGELOG.md`, `.github/`, `.gitignore`
  are **hand-maintained** and never overwritten.
- `_migration/cache.json` is **script-owned** — do not edit it by hand.

## What is NOT safe to edit by hand

- Anything under `src/` and the generated support files (`package.json`,
  `tsconfig.json`, `.env.example`, `LICENSE`, `prisma/`) are overwritten on every
  sync. Edit them in the source repository instead.
