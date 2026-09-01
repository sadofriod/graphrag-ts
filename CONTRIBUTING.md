# Contributing Guide

Thank you for your interest in contributing to `graphrag-ts`. This repository is maintained as a standalone project, and code and documentation are modified directly in this repository. Before opening a pull request, please read this guide and make sure your changes stay within the current repository's intended boundaries.

## 1. Read these documents first

- [README.md](README.md)
- [docs/architecture.md](docs/architecture.md)
- [docs/migration.md](docs/migration.md)
- [docs/comparison.md](docs/comparison.md)

If you are modifying implementation, architecture, or documentation, please follow the current repository structure rather than relying on historical migration workflows.

## 2. Code ownership boundaries

### Directly maintained

The following paths may be modified directly in this repository:

- `src/`
- `README.md`
- `docs/`
- `examples/`
- `CHANGELOG.md`
- `.github/`
- `.gitignore`
- `CONTRIBUTING.md`
- `package.json`
- `tsconfig.json`
- `.env.example`
- `LICENSE`
- `prisma/`

### Historical legacy directories

The following directory is retained for historical context and compatibility information and is generally not the primary entry point for normal development:

- `_migration/`

Please do not rely on `_migration/cache.json` as the real source of truth during normal development; it is kept only for historical migration context and reference.

## 3. Local development workflow

1. Install dependencies:

```bash
pnpm install
pnpm run db:generate
```

2. Set environment variables:

```bash
cp .env.example .env
```

3. Run focused validation:

```bash
bun run lint
bun run typecheck
bun test
```

4. For documentation-only changes, state clearly in the PR that the work is a documentation change and does not modify runtime behavior.

## 4. Commit conventions

This repository follows the Conventional Commits specification. Please format commit messages as:

```text
<type>(<scope>): <short summary>
```

Examples:

```text
feat(retrieval): add hybrid recall fallback
fix(namespace): resolve scoped client path normalization
docs(contributing): localize guide and add conventional commits
chore(deps): update Prisma client version
```

### Allowed commit types

- `feat`: a new feature
- `fix`: a bug fix
- `docs`: documentation-only changes
- `refactor`: code refactoring without behavior changes
- `test`: test updates or additions
- `chore`: maintenance tasks, tooling, or dependency updates
- `perf`: performance improvements
- `ci`: CI or automation changes

### Commit guidance

- Keep one PR focused on one clearly defined problem
- Keep the change scope as small as possible and avoid unrelated cleanup
- If runtime behavior changes, add or update the relevant tests
- Use concise, descriptive commit messages that explain what changed and why
- Prefer a scope when the change is limited to a module or subsystem

## 5. Pull request checklist

A PR description should ideally include:

- problem summary
- change overview
- impact area
- validation performed (for example, `pnpm install`, `bun test`, `bun run typecheck`)
- any known limitations or follow-up work

## 6. Open an issue or pull request

- If you find a bug, missing feature, or unclear documentation, open an issue first
- If you are proposing a larger change, explain which modules are involved and whether the existing usage patterns are affected
- For complex features, it is best to discuss the design before implementing the code

## 7. Code of conduct

Please keep interactions:

- respectful
- specific
- constructive
- focused on the problem and the code rather than personal attacks

## 8. Contribution vision

This repository aims to:

- make the GraphRAG reference implementation easier to learn and extend
- keep the project structure clear and modular
- keep documentation aligned with actual code and configuration

Thank you for contributing.
