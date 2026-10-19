import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { Pool } from 'pg';
import { z } from 'zod';
import { loadConfig } from '../config.ts';
import { createStore } from '../store.ts';
import { workspaceIdSchema } from '../workspace.ts';
import { corpusHash, evaluateSources, loadCorpus, questions, type SourceExcerpt } from './fixture.ts';

const settings = () => z.object({
  MCP_COMPARE_EMBEDDING_CONFIRMED: z.literal('true'),
  MCP_COMPARE_URL: z.string().url().default('http://127.0.0.1:3000/mcp'),
  MCP_COMPARE_WORKSPACE: workspaceIdSchema.default('project-history'),
  MCP_COMPARE_TOP_K: z.coerce.number().int().min(1).max(20).default(5),
  MCP_COMPARE_API_KEY: z.string().min(1).optional(),
  RAG_EMBED_BASE_URL: z.string().url(),
  RAG_EMBED_MODEL: z.string().min(1),
  RAG_EMBED_API_KEY: z.string().min(1),
}).parse(process.env);

type Settings = ReturnType<typeof settings>;

const embed = async (query: string, config: Settings) => {
  const response = await fetch(`${config.RAG_EMBED_BASE_URL.replace(/\/$/, '')}/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.RAG_EMBED_API_KEY}` },
    body: JSON.stringify({ model: config.RAG_EMBED_MODEL, input: query }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Embedding request failed with HTTP ${response.status}.`);
  const parsed = z.object({
    data: z.array(z.object({ embedding: z.array(z.number().finite()).length(768) })).length(1),
    usage: z.object({ total_tokens: z.number().int().min(0) }).optional(),
  }).parse(await response.json());
  return { vector: parsed.data[0]!.embedding, tokens: parsed.usage?.total_tokens ?? null };
};

const vectorProbe = async (pool: Pool, namespace: string, query: string, config: Settings) => {
  const started = performance.now();
  const embedded = await embed(query, config);
  const result = await pool.query<SourceExcerpt>(
    `SELECT p.title AS source, LEFT(c.content, 500) AS excerpt
     FROM rag_children c JOIN rag_parents p ON p.id = c.parent_id AND p.namespace = c.namespace
     WHERE c.namespace = $1 AND c.embedding IS NOT NULL
     ORDER BY c.embedding <=> $2::vector, c.id LIMIT $3`,
    [namespace, JSON.stringify(embedded.vector), config.MCP_COMPARE_TOP_K],
  );
  return { sources: result.rows, duration_ms: performance.now() - started, embedding_api_calls: 1, tokens: embedded.tokens };
};

const queryOutputSchema = z.object({
  sources: z.array(z.object({ source: z.string(), excerpt: z.string() })),
  index_version: z.object({ id: z.string(), workspace_id: z.string() }),
  truncated: z.boolean(),
});

const graphProbe = async (
  client: Client,
  query: string,
  config: Settings,
  versionId: string,
  sourceTitles: ReadonlyMap<string, string>,
) => {
  const started = performance.now();
  const result = await client.callTool({
    name: 'query_graph',
    arguments: { query, workspace_id: config.MCP_COMPARE_WORKSPACE, max_results: config.MCP_COMPARE_TOP_K },
  }, undefined, { timeout: 130_000, maxTotalTimeout: 130_000 });
  if (result.isError) throw new Error('GraphRAG MCP query failed; inspect its job, allowance and model logs.');
  const content = z.array(z.object({ type: z.literal('text'), text: z.string() })).min(1).parse(result.content);
  const output = queryOutputSchema.parse(JSON.parse(content.map((item) => item.text).join('\n')));
  if (output.index_version.id !== versionId || output.index_version.workspace_id !== config.MCP_COMPARE_WORKSPACE) {
    throw new Error('The active snapshot changed or MCP points to a different database/workspace. Discard this comparison.');
  }
  return {
    sources: output.sources.map((source) => ({ ...source, source: sourceTitles.get(source.source) ?? source.source })),
    duration_ms: performance.now() - started,
    truncated: output.truncated,
    api_calls: null,
    tokens: null,
  };
};

const runComparison = async (config: Settings, databaseUrl: string) => {
  const store = createStore(databaseUrl);
  const pool = new Pool({ connectionString: databaseUrl });
  const client = new Client({ name: 'project-history-evidence-probe', version: '1.0.0' });
  let lease: Awaited<ReturnType<typeof store.acquireActiveVersionLease>> = null;
  try {
    lease = await store.acquireActiveVersionLease(config.MCP_COMPARE_WORKSPACE, 1_800_000);
    if (!lease) throw new Error('Index the project-history corpus before running this probe.');
    const snapshot = await store.getActiveSnapshot(config.MCP_COMPARE_WORKSPACE);
    const expectedHash = corpusHash(await loadCorpus());
    if (snapshot.version?.id !== lease.id || corpusHash(snapshot.sources) !== expectedHash) {
      throw new Error('The active snapshot does not exactly match the four original project-history documents.');
    }
    const titles = await pool.query<{ id: string; title: string }>(
      'SELECT id, title FROM rag_parents WHERE namespace = $1', [lease.namespace],
    );
    const transport = new StreamableHTTPClientTransport(new URL(config.MCP_COMPARE_URL), {
      requestInit: { headers: config.MCP_COMPARE_API_KEY ? { Authorization: `Bearer ${config.MCP_COMPARE_API_KEY}` } : {} },
    });
    // The SDK getter permits undefined, unlike its exact-optional Transport declaration.
    await client.connect(transport as Transport);
    const rows = [];
    for (const question of questions) {
      const baseline = await vectorProbe(pool, lease.namespace, question.query, config);
      const graph = await graphProbe(client, question.query, config, lease.id, new Map(titles.rows.map((row) => [row.id, row.title])));
      rows.push({
        id: question.id, query: question.query,
        vector: { ...baseline, ...evaluateSources(question.sources, baseline.sources) },
        graph: { ...graph, ...evaluateSources(question.sources, graph.sources) },
      });
    }
    return {
      kind: 'retrieval-evidence-probe-not-answer-quality-ranking',
      corpus_sha256: expectedHash, version_id: lease.id, workspace_id: lease.workspaceId,
      embedding_model: config.RAG_EMBED_MODEL, top_k: config.MCP_COMPARE_TOP_K,
      monetary_cost: null, rows,
    };
  } finally {
    try {
      await client.close();
    } finally {
      try {
        if (lease) await store.releaseQueryLease(lease.leaseId);
      } finally {
        await Promise.all([pool.end(), store.close()]);
      }
    }
  }
};

if (import.meta.main) {
  try {
    const { DATABASE_URL } = loadConfig();
    console.log(JSON.stringify(await runComparison(settings(), DATABASE_URL), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Project-history comparison failed.');
    process.exitCode = 1;
  }
}
