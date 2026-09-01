# Historical migration notes

This repository is now maintained as a standalone project. The notes below are kept only for historical context and document the earlier migration setup that existed before the project became independent.

## Current status

- `src/` is maintained directly in this repository.
- There is no longer an automated sync from an upstream monorepo or source repository.
- Documentation, examples, and project configuration are maintained in place.
- `_migration/` is retained as a historical artifact and should not be treated as an active source of truth.

## Legacy context

Before the repository became independent, the codebase was migrated from a larger internal project. That migration involved a few practical steps:

1. Copying the original rag implementation into a working tree.
2. Removing or adapting internal-only configuration and runtime assumptions.
3. Rewriting import paths and environment-based configuration.
4. Recording migration metadata in `_migration/cache.json` for traceability.

This earlier process is now only relevant for historical reference. Ongoing development should be based on the files in the current repository itself.

## What to edit today

- `README.md`, `docs/`, `examples/`, `CHANGELOG.md`, `.github/`, `.gitignore`, `src/`, `package.json`, `tsconfig.json`, `.env.example`, `LICENSE`, and `prisma/` should all be edited directly in this repository.
- `_migration/cache.json` is a legacy artifact and should only be touched intentionally for historical maintenance or restoration work.

## Practical guidance

Treat this repository as a self-contained project, not as a generated mirror of another codebase. If you are making a change, implement it here; do not assume that an upstream repository or automation will regenerate the code for you.
