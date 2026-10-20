# Hermes and OpenClaw

GraphRAG is a standard Streamable HTTP MCP server, not an officially approved
Hermes/OpenClaw plugin. No `hermes plugins install` or `npx skills add` integration
is claimed. A configured MCP server does not bypass the agent's own tool policies.
The [Hermes MCP catalog manifest](hermes-manifest.yaml) is a submission candidate,
not an approved catalog entry.

## Local connection

1. Configure models and start the [root Compose stack](../../../docker-compose.yml).
   The client snippets use the default host port `3000`; if `MCP_PORT` is
   overridden, change the URL in the selected snippet to match it.
2. Merge [hermes.yaml](hermes.yaml) into `~/.hermes/config.yaml`, or merge
   [openclaw.json](openclaw.json) into `~/.openclaw/openclaw.json`. Do not overwrite
   existing settings.
3. Reload Hermes MCP connections (`/reload-mcp`) or start a new session.
   For OpenClaw, run `openclaw mcp doctor graphrag --probe`.
4. Ask the agent to list the GraphRAG tools, then use a single workspace consistently:

```text
Use graphrag's submit_index_job with workspace_id="project-history" and path=".".
Poll get_index_job with that workspace and the returned job_id until succeeded.
Only then query_graph: "Why did we replace Redis session storage with PostgreSQL,
and which modules changed?" Include the returned source excerpts and index version.
Do not infer an answer if indexing failed or the evidence is missing.
```

For that question, mount the original fictional [project-history corpus](../../../examples/project-history/README.md).
For the dataset scenario, use the [Web3 sample](../../../examples/web3-smart-contract-security/README.md).
`remember_text` only ingests explicitly supplied text; it does not read agent history.

## Hosted credentials

The local Compose setup does not enable hosted access by itself. To enable
metered access, create a server-side policy based on the
[access policy example](../access/accounts.example.json) and set
`MCP_ACCESS_FILE` to its path inside the container (for example,
`/app/access/accounts.json`). The Compose stack mounts `integrations/mcp/access`
read-only at `/app/access`.

For remote clients, use an operator-managed HTTPS gateway URL, not a publicly
exposed unencrypted Bun port. Configure the `Authorization: Bearer <credential>`
header using your client's supported secret mechanism. Hermes documents HTTP
`headers`; OpenClaw documents sensitive headers through its secret mechanisms.
Do not commit a live header or assume shell-style `${VAR}` interpolation works
in every client/version. A `workspace_id` is not an authentication credential.

Hosted accounts cannot call `submit_index_job` against the shared server filesystem.
Use `remember_text` with the account's assigned workspace. `query_graph_global`
also needs an explicit `global_query` grant. A successful tool listing is not a
permission grant. `FORBIDDEN` is not a transient model error, and
`QUOTA_EXCEEDED` should not trigger automatic retry loops.

## Containers and verification boundary

The examples assume the agent runs on the host. Inside a container, loopback
refers to that container. Use an operator-managed reverse proxy reachable by the
agent. The MCP handler accepts non-local Host headers, so keep the origin bound
to loopback behind the proxy and configure `MCP_ACCESS_FILE` for internet-facing
access; do not expose an unauthenticated MCP endpoint publicly.

Sources checked on 2026-10-18:

- [Hermes MCP configuration reference](https://hermes-agent.nousresearch.com/docs/reference/mcp-config-reference)
- [Hermes MCP guide](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp/)
- [OpenClaw MCP guide](https://docs.openclaw.ai/tools/mcp)

These configuration shapes are checked against the upstream documentation.
Repository protocol tests exercise initialization, discovery, tool calls and
tenant isolation, but are not proof of a live Hermes/OpenClaw installation.
