# Contributing

Thanks for contributing to `graphrag-ts`. This repository mixes generated source code with hand-maintained documentation, so please read these guidelines before opening a pull request.

## Before you start

- Read [README.md](./README.md), [docs/architecture.md](./docs/architecture.md), and [docs/migration.md](./docs/migration.md).
- Check whether your change belongs in this public repository or in the upstream source repository that generates `src/`.
- Prefer small, focused pull requests with a clear motivation and validation notes.

## Repository ownership model

### Hand-maintained files

You can safely edit these paths in this repository:

- `README.md`
- `docs/`
- `examples/`
- `CHANGELOG.md`
- `.github/`
- `.gitignore`

### Generated files

These paths are overwritten by the migration pipeline and should normally be changed in the upstream source repository instead:

- `src/`
- `package.json`
- `tsconfig.json`
- `.env.example`
- `LICENSE`
- `prisma/`

Do not hand-edit `_migration/cache.json`.

## Development workflow

1. Install dependencies:

   ```bash
   bun install
   bun run db:generate
   ```

2. Set up environment variables if your change needs the database or live models:

   ```bash
   cp .env.example .env
   ```

3. Run the relevant checks before opening a PR:

   ```bash
   bun run lint
   bun run typecheck
   bun test
   ```

4. If you changed documentation only, mention that in the PR so reviewers can scope validation appropriately.

## Testing expectations

- Add or update tests when you change runtime behavior.
- Keep changes targeted; do not remove unrelated tests to make the suite pass.
- Prefer existing test utilities and repository conventions over new helpers.

## Pull request checklist

Please include the following in your PR description:

- A short summary of the problem and the change
- Any generated vs hand-maintained paths you touched
- Validation performed (`bun run lint`, `bun run typecheck`, `bun test`, or docs-only)
- Follow-up work or known limitations, if any

## Reporting issues and proposing changes

- Open an issue for bugs, missing features, or documentation gaps when discussion is useful before implementation.
- For larger changes to the generated pipeline, describe how the change should flow back to the upstream source repository.

## Code of conduct

Be respectful, constructive, and specific in issues and pull requests.
