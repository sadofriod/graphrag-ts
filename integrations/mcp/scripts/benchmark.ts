import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  CORPUS_SCOPE_QUERIES,
  IN_CORPUS_RECALL_QUERIES,
  QUICKSTART_RECALL_QUERIES,
} from '../../../examples/benchmark-recall/dataset';
import { evaluateRecall } from '../../../examples/benchmark-recall/evaluation';
import { aggregateResults, formatMarkdownReport } from '../../../examples/benchmark-recall/report';
import type { PerQueryResult, RecallQuery } from '../../../examples/benchmark-recall/types';

interface McpQueryResponse {
  readonly answer?: string;
  readonly sources?: readonly { readonly source: string; readonly excerpt: string }[];
}

interface BenchmarkQueryResult {
  readonly query: RecallQuery;
  readonly response: McpQueryResponse;
  readonly durationMs: number;
}

const endpoint = process.env.MCP_BENCHMARK_URL ?? 'http://127.0.0.1:3000/mcp';
const pollIntervalMs = 1_000;
const skipBuild = process.env.MCP_BENCHMARK_SKIP_BUILD === 'true';
const onlyInCorpusRecall = process.env.MCP_BENCHMARK_ONLY_IN_CORPUS === 'true';
const quickProfile = process.env.MCP_BENCHMARK_PROFILE === 'quick';

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const EXPLICIT_ABSTENTION_PATTERN = /\b(?:i (?:cannot|can't|could not|don't know|do not know|don't have enough)|there (?:is|isn't) not enough|no relevant (?:information|evidence)|not (?:present|mentioned|available) in the (?:provided )?(?:context|sources|documents|corpus))\b/i;

const isTextContent = (item: unknown): item is { type: 'text'; text: string } =>
  typeof item === 'object'
  && item !== null
  && 'type' in item
  && item.type === 'text'
  && 'text' in item
  && typeof item.text === 'string';

const readToolText = (result: unknown): string => {
  if (typeof result !== 'object' || result === null || !('content' in result) || !Array.isArray(result.content)) {
    throw new Error('MCP tool returned a task result instead of content.');
  }

  const textContent = result.content.filter(isTextContent);
  if ('isError' in result && result.isError === true) {
    throw new Error(textContent.map((item) => item.text).join('\n') || 'MCP tool call failed.');
  }

  return textContent
    .map((item) => item.text)
    .join('\n');
};

const callToolJson = async <T>(
  client: Client,
  name: string,
  args: Record<string, unknown>,
  timeoutMs?: number,
): Promise<T> => JSON.parse(readToolText(await client.callTool(
  { name, arguments: args },
  undefined,
  timeoutMs === undefined ? undefined : { timeout: timeoutMs, maxTotalTimeout: timeoutMs },
))) as T;

const waitForIndex = async (client: Client, jobId: string): Promise<void> => {
  let polls = 0;
  for (;;) {
    const job = await callToolJson<{
      status: string;
      phase?: string;
      error?: { code: string; summary: string } | null;
    }>(client, 'get_index_job', { job_id: jobId });

    if (job.status === 'succeeded') {
      return;
    }
    if (job.status === 'failed') {
      throw new Error(`Indexing failed (${job.error?.code ?? 'unknown'}): ${job.error?.summary ?? 'no details'}`);
    }

    polls += 1;
    if (polls % 10 === 0) {
      console.log(`Indexing ${job.phase ?? job.status}...`);
    }
    await delay(pollIntervalMs);
  }
};

const runQueries = async (
  client: Client,
  queries: readonly RecallQuery[],
  group: string,
): Promise<BenchmarkQueryResult[]> => {
  const results: BenchmarkQueryResult[] = [];
  for (const query of queries) {
    const startedAt = performance.now();
    const response = await callToolJson<McpQueryResponse>(
      client,
      'query_graph',
      { query: query.query, max_results: query.topK },
      130_000,
    );
    const durationMs = performance.now() - startedAt;
    console.log(`${group} ${query.id}: ${durationMs.toFixed(0)}ms`);
    results.push({ query, response, durationMs });
  }
  return results;
};

const toRecallResults = (results: readonly BenchmarkQueryResult[]): PerQueryResult[] =>
  results.map(({ query, response }) => ({
    query,
    evaluation: evaluateRecall(JSON.stringify(response), query.expectation),
  }));

const averageLatencyMs = (results: readonly BenchmarkQueryResult[]): number =>
  results.length === 0
    ? 0
    : results.reduce((sum, result) => sum + result.durationMs, 0) / results.length;

const printScopeReport = (results: readonly BenchmarkQueryResult[]): void => {
  const unsupported = results.filter(({ query }) => query.sourceCoverage === 'not-indexed');
  const controls = results.filter(({ query }) => query.sourceCoverage === 'indexed');
  const explicitAbstentions = unsupported.filter(({ response }) =>
    EXPLICIT_ABSTENTION_PATTERN.test(response.answer ?? ''),
  );
  const unsupportedRows = unsupported.map(({ query, response }) => ({
    id: query.id,
    explicitAbstention: EXPLICIT_ABSTENTION_PATTERN.test(response.answer ?? ''),
    sourceCount: response.sources?.length ?? 0,
    phraseLeak: evaluateRecall(JSON.stringify(response), query.expectation).phraseRecall > 0,
  }));
  const phraseLeaks = unsupportedRows.filter(({ phraseLeak }) => phraseLeak);
  const resultsWithSources = unsupported.filter(({ response }) => (response.sources?.length ?? 0) > 0);

  console.log('# Corpus Scope Probe (12 preserved questions)');
  console.log(`- Out-of-corpus questions: ${unsupported.length}`);
  console.log(`- Explicit refusal responses: ${explicitAbstentions.length} / ${unsupported.length}`);
  console.log(`- Out-of-corpus responses with source excerpts: ${resultsWithSources.length} / ${unsupported.length}`);
  console.log(`- Responses containing expected out-of-corpus phrases: ${phraseLeaks.length} / ${unsupported.length}`);
  console.log(`- Indexed positive controls: ${controls.length}`);
  console.log(`- Positive-control average query latency: ${averageLatencyMs(controls).toFixed(0)}ms`);
  console.log('');
  console.log('| Query | Explicit refusal | Source excerpts | Expected phrase surfaced |');
  console.log('|---|:---:|:---:|:---:|');
  for (const row of unsupportedRows) {
    console.log(`| ${row.id} | ${row.explicitAbstention ? 'yes' : 'no'} | ${row.sourceCount} | ${row.phraseLeak ? 'yes' : 'no'} |`);
  }
  console.log('');
  console.log('## Positive-control recall');
  console.log('');
  const controlResults = toRecallResults(controls);
  console.log(formatMarkdownReport(aggregateResults(controlResults), controlResults));
};

const main = async (): Promise<void> => {
  const client = new Client({ name: 'graphrag-mcp-benchmark', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint));

  try {
    await client.connect(transport as Transport);

    let buildDurationMs: number | undefined;
    if (skipBuild) {
      console.log('Reusing the active published snapshot.');
    } else {
      const buildStartedAt = performance.now();
      const submitted = await callToolJson<{ job_id: string }>(client, 'submit_index_job', { path: '.' });
      await waitForIndex(client, submitted.job_id);
      buildDurationMs = performance.now() - buildStartedAt;
    }

    const querySet = quickProfile
      ? QUICKSTART_RECALL_QUERIES
      : IN_CORPUS_RECALL_QUERIES;
    const scopeResults = onlyInCorpusRecall || quickProfile
      ? []
      : await runQueries(client, CORPUS_SCOPE_QUERIES, 'Scope');
    const recallResults = await runQueries(client, querySet, quickProfile ? 'Quick' : 'Recall');
    const allResults = [...scopeResults, ...recallResults];

    console.log('# Docker MCP Recall Benchmark');
    console.log(`- MCP endpoint: ${endpoint}`);
    console.log(`- Index duration: ${buildDurationMs === undefined ? 'reused' : `${(buildDurationMs / 1_000).toFixed(1)}s`}`);
    console.log(`- Average query latency: ${averageLatencyMs(allResults).toFixed(0)}ms`);
    console.log('');
    if (!onlyInCorpusRecall && !quickProfile) {
      printScopeReport(scopeResults);
    }
    console.log(quickProfile ? '# Docker Quickstart Benchmark' : '# In-Corpus Recall Benchmark');
    console.log('');
    const inCorpusResults = toRecallResults(recallResults);
    console.log(formatMarkdownReport(aggregateResults(inCorpusResults), inCorpusResults));
  } finally {
    await client.close();
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'MCP benchmark failed.');
  process.exitCode = 1;
});
