# graphrag-ts

[![Listed on mcpservers.org](https://mcpservers.org/badge.svg)](https://mcpservers.org/servers/sadofriod/graphrag-ts)
[![graphrag-ts MCP server](https://glama.ai/mcp/servers/sadofriod/graphrag-ts/badges/score.svg)](https://glama.ai/mcp/servers/sadofriod/graphrag-ts)

> **Attribution is stored at write time, not asserted at read time.**

`graphrag-ts` is a GraphRAG engine in TypeScript. It builds the knowledge graph in PostgreSQL,
keeps source evidence on every node and edge, and answers with retrievable citations — or returns
an explicit abstention when the coverage behind an answer is too thin to support it.

> **Benchmarks / 基准报告**
> [English report](examples/output/final-benchmark-report.en.md) · [中文报告](examples/output/final-benchmark-report.md)

> **Hosted endpoint** / 托管端点
> `https://mcp.ashesborn.cloud/mcp` (anonymous tier: free `integrity_paper_status`, the two judgments answer with an x402 payment requirement; a keyed session unlocks them) · free DOI status: `https://pay.ashesborn.cloud/api/v1/judge/paper?doi=` · [x402 wire format](https://blog.ashesborn.cloud/blog/x402-integration-http-and-mcp)

[![graphrag-ts-pg MCP connector – tool definition quality and endpoint health on Glama](https://glama.ai/mcp/connectors/cloud.ashesborn.graphrag-ts/graphrag-ts-pg/badges/score.svg)](https://glama.ai/mcp/connectors/cloud.ashesborn.graphrag-ts/graphrag-ts-pg)

## Try it in 60 seconds

No install, no API key, no model endpoint. Two ways in:

- **In a browser:** [Retraction Status](https://huggingface.co/spaces/ashesborn6/retraction-status) — paste a DOI, get the source-by-source retraction status and the evidence tiers behind it, with no local model and no account.
- **From the command line:**

```bash
curl -s 'https://pay.ashesborn.cloud/api/v1/judge/paper?doi=10.1016/S0140-6736(97)11096-0'
```

The response is the paper plus every retraction record behind it, each with its `source_tier` and
`source_uri` — the evidence the graph stores, not a model's recollection of it.

Point any Streamable HTTP MCP client at the hosted endpoint (public read tier, 20 requests/minute
per IP):

```json
{
  "mcpServers": {
    "graphrag-ts": { "url": "https://mcp.ashesborn.cloud/mcp" }
  }
}
```

A bearer API key unlocks the full tool set (graph queries, index jobs, memory writes). The two
judgment tools also answer per call without a key via x402 payment ($0.02 / $0.10).

## What it does differently

- **Postgres-native.** Graph tables and pgvector live in the database you already operate — no
  Neo4j sidecar and no second store to keep in sync.
- **Incremental by construction.** Rebuilds reuse unchanged community summaries, so the cost of a
  refresh tracks the delta rather than the corpus size.
- **Two retrieval shapes.** Local: hybrid vector, keyword and graph retrieval over a community's
  evidence. Global: Map-Reduce over community summaries for corpus-wide questions.
- **Explicit abstention.** Judgment verdicts carry source tiers and return an abstention when
  reference coverage is thin, instead of answering from a weak signal.
- **Evidence at chunk level.** Entities and relationships keep the document and chunk they were
  extracted from, so an answer can be traced back to the text that produced it.

## MCP tools

| Tool | Access | What it does |
| --- | --- | --- |
| `query_graph` | keyed | Local hybrid retrieval against the latest published snapshot in a workspace |
| `query_graph_global` | keyed | Corpus-wide Map-Reduce retrieval over community summaries |
| `submit_index_job` | keyed | Queue Markdown from the configured input directory for indexing |
| `remember_text` | keyed | Queue user-provided text explicitly; never reads chat history |
| `get_index_job` | keyed | Status and safe error summary for an index job |
| `integrity_paper_status` | public | Retraction status and identity for a paper |
| `retraction_propagation` | public / x402 | Judge whether retraction evidence propagates to a paper |
| `integrity_evidence_audit` | public / x402 | Audit the evidence path, source tiers and conflicts for a paper |

## Quick start — self-hosted

### MCP with Docker Compose

The Compose stack starts PostgreSQL/pgvector and the MCP service. You must provide reachable chat
and embedding endpoints; see the [MCP guide](integrations/mcp/README.md) for configuration, client
setup, and workspace behavior.

```bash
cp .env.example .env
# Configure the database password and model endpoints in .env.
docker compose up -d --build
curl http://127.0.0.1:3000/healthz
```

Connect an MCP client to `http://127.0.0.1:3000/mcp`. For the optional local browser showcase,
configure the models and run `docker compose --profile showcase up -d --build --wait`, then open
`http://127.0.0.1:8080`. The showcase is a local demo, not an authentication layer; do not expose
it to untrusted users.

### Install the package

```bash
bun add @ashes_born/graph-rag-ts
```

The package ships TypeScript sources consumed directly by Bun and requires Bun >= 1.1.
It is not importable from plain Node without a TypeScript loader.
It expects PostgreSQL with pgvector and RAG_* model settings configured as in the self-hosted path below.
Published package: https://www.npmjs.com/package/@ashes_born/graph-rag-ts.

### Use the library

```bash
pnpm install
pnpm run db:generate
cp .env.example .env
# Configure DATABASE_URL and RAG_* model settings; see the guides below.
pnpm run db:push
bun run examples/demo.ts
```

The library requires Bun, PostgreSQL with pgvector, and compatible chat and embedding endpoints.
See the [English guide](docs/en-US.md) or [中文指南](docs/zh-CN.md) for environment setup, API
examples, adapters, and tuning.

## Overview

- Markdown ingestion, entity/relationship extraction, and community detection
- Full and incremental builds, with unchanged community summaries reused
- Hybrid vector, keyword, and graph retrieval, plus corpus-wide Map-Reduce queries
- MCP server with isolated workspaces and a local browser showcase

See [the architecture guide](docs/architecture.md) for the pipeline and module details.

## Benchmark

The reported in-corpus run reached 10/12 strict hits and 95.8% combined lexical recall on 12
questions from five indexed chapters. This is a small project benchmark, not human semantic
grading or a cross-project comparison. The reports include methodology, per-query results, and
limitations.

The English and Chinese reports are linked at the top of this page.
To run the three-question Docker smoke benchmark, use `pnpm benchmark:docker:quick` with the model
endpoints configured and loaded. See the [MCP guide](integrations/mcp/README.md) for prerequisites
and the report for benchmark scope.

## Listed on

- [Official MCP Registry](https://registry.modelcontextprotocol.io/?q=io.github.sadofriod%2Fgraphrag-ts) — `io.github.sadofriod/graphrag-ts`
- [Glama](https://glama.ai/mcp/servers/sadofriod/graphrag-ts) — server rating, plus the [connector listing](https://glama.ai/mcp/connectors/cloud.ashesborn.graphrag-ts/graphrag-ts-pg) for the hosted endpoint
- [mcpservers.org](https://mcpservers.org/servers/sadofriod/graphrag-ts)

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
