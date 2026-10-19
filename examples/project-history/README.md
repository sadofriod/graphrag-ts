# Decision-history demo

Four original, fictional MIT-licensed documents in [corpus/](corpus/) connect a
session-storage decision to modules, owners, rollout gates and a deliberately
out-of-scope Redis cache. This compact smoke fixture is not the larger public
5,000–10,000-word benchmark proposed in the promotion strategy.

```sh
INPUT_HOST_DIR=./examples/project-history/corpus docker compose up -d --build --wait
```

Connect [Hermes or OpenClaw](../../integrations/mcp/clients/README.md), submit
`{"workspace_id":"project-history","path":"."}`, and poll that job until it
succeeds. Do not index this README as part of the corpus. In hosted mode ingest
the four documents separately through `remember_text`, preserving their filenames
as `source` and the same workspace; shared filesystem ingestion is disabled.

Five relationship questions:

1. Why replace Redis sessions with PostgreSQL, and which modules changed?
2. Which team owns cleanup, and which rollout checks must it review?
3. Which Redis workload remained, and why was it outside ADR-007?
4. How does account suspension reach the session store, and who owns those modules?
5. Why is a Redis deletion retry queue insufficient for the decision's goal?

Expected evidence is encoded in the [comparison fixture](../../integrations/mcp/src/compare/fixture.ts).
These are expectations, **not generated answers or proof that GraphRAG beats
vector retrieval**. Ask the agent to show source excerpts and the snapshot ID.

## Same-snapshot retrieval probe

For an operator with database access, the runner compares pgvector top-k child
chunks against the actual `query_graph` MCP output. Both use the same immutable
index version; a changed version or a different corpus aborts the report.
Confirm the embedding endpoint/model exactly matches the indexed snapshot.

```sh
# DATABASE_URL must reach the SAME database as the MCP server.
# RAG_EMBED_BASE_URL, RAG_EMBED_MODEL and RAG_EMBED_API_KEY must match its index.
MCP_COMPARE_EMBEDDING_CONFIRMED=true pnpm demo:project-history
```

Optional environment: `MCP_COMPARE_URL` (default `http://127.0.0.1:3000/mcp`),
`MCP_COMPARE_WORKSPACE` (default `project-history`), `MCP_COMPARE_API_KEY`,
`MCP_COMPARE_TOP_K` (default 5).

The JSON report contains raw excerpts, source-document coverage, cross-document
coverage, latency, snapshot/corpus identity, and explicitly unavailable metrics.
Vector excerpts and MCP excerpts are limited to 500 characters. GraphRAG top-k
selects communities, not k identical child chunks; its answer generation and
output budget differ from the retrieval-only baseline. Consequently this is a
retrieval evidence probe, **not a controlled answer-quality or speed ranking**.
It does not score answer text or treat file hits as semantic correctness.

The runner records one baseline embedding request per question and reports
provider-returned embedding token usage where available. MCP-internal API calls,
tokens and monetary cost are `null`, not fabricated estimates. It never indexes
automatically, prints credentials or replaces an existing report file.
Failed runs exit nonzero. Review provider logs and perform a fully controlled
same-prompt experiment before publishing comparative accuracy/cost claims.
