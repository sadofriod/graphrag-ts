# graphrag-ts

> TypeScript GraphRAG for Markdown corpora. Build a knowledge graph, detect communities, and answer with evidence-backed retrieval.

> **Benchmarks / 基准报告**
> [English report](examples/output/final-benchmark-report.en.md) · [中文报告](examples/output/final-benchmark-report.md)

## Overview

`graphrag-ts` is a TypeScript GraphRAG reference implementation for Markdown corpora. It builds a knowledge graph in PostgreSQL and answers questions with hybrid retrieval and source evidence, without requiring a Python runtime.

- Markdown ingestion, entity/relationship extraction, and community detection
- Full and incremental builds, with unchanged community summaries reused
- Hybrid vector, keyword, and graph retrieval, plus corpus-wide Map-Reduce queries
- MCP server with isolated workspaces and a local browser showcase

See [the architecture guide](docs/architecture.md) for the pipeline and module details.

## Quick start

### MCP with Docker Compose

The Compose stack starts PostgreSQL/pgvector and the MCP service. You must provide reachable chat and embedding endpoints; see the [MCP guide](integrations/mcp/README.md) for configuration, client setup, and workspace behavior.

```bash
cp .env.example .env
# Configure the database password and model endpoints in .env.
docker compose up -d --build
curl http://127.0.0.1:3000/healthz
```

Connect an MCP client to `http://127.0.0.1:3000/mcp`. For the optional local browser showcase, configure the models and run `docker compose --profile showcase up -d --build --wait`, then open `http://127.0.0.1:8080`. The showcase is a local demo, not an authentication layer; do not expose it to untrusted users.

### Use the library

```bash
pnpm install
pnpm run db:generate
cp .env.example .env
# Configure DATABASE_URL and RAG_* model settings; see the guides below.
pnpm run db:push
bun run examples/demo.ts
```

The library requires Bun, PostgreSQL with pgvector, and compatible chat and embedding endpoints. See the [English guide](docs/en-US.md) or [中文指南](docs/zh-CN.md) for environment setup, API examples, adapters, and tuning.

## Benchmark

The reported in-corpus run reached 10/12 strict hits and 95.8% combined lexical recall on 12 questions from five indexed chapters. This is a small project benchmark, not human semantic grading or a cross-project comparison. The reports include methodology, per-query results, and limitations.

The English and Chinese reports are linked at the top of this page.
To run the three-question Docker smoke benchmark, use `pnpm benchmark:docker:quick` with the model endpoints configured and loaded. See the [MCP guide](integrations/mcp/README.md) for prerequisites and the report for benchmark scope.

## Documentation

- [docs/architecture.md](docs/architecture.md): architecture and data flow
- [docs/en-US.md](docs/en-US.md): English user guide
- [docs/zh-CN.md](docs/zh-CN.md): Chinese user guide
- [docs/comparison.md](docs/comparison.md): comparison notes
- [integrations/mcp/docs/x402-paid-api.md](integrations/mcp/docs/x402-paid-api.md): optional x402 paid query API, dataset bundles
- [integrations/mcp/docs/hosted-beta.md](integrations/mcp/docs/hosted-beta.md): hosted pilot operations checklist
- [integrations/mcp/docs/x402-discovery.md](integrations/mcp/docs/x402-discovery.md): how agents discover the paid API (Bazaar, .well-known/x402)
- [integrations/mcp/docs/deploy-x402.md](integrations/mcp/docs/deploy-x402.md): deploying the paid API on a Docker/Colima host behind Cloudflare Tunnel
- [CONTRIBUTING.md](CONTRIBUTING.md): contribution guide

## Contributing

Contributions are welcome through issues and pull requests. The project is organized around small, testable modules, so the most useful changes usually fit into one of these areas:

- graph construction quality
- retrieval quality and ranking
- namespace isolation
- model-loading robustness
- documentation and examples

## License

MIT
