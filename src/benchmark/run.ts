import type { RetrievalResult } from '../retrieval/types/retrieval';
import type { RagApiClient } from './client';
import { createRagApiClient } from './client';
import { buildRetrievedContext } from './context';
import { BENCHMARK_QUERIES, type BenchmarkQuery } from './dataset';
import { evaluateRecall, type QueryEvaluation } from './evaluate';
import { formatMarkdownReport } from './format';
import type { BenchmarkReport, PerQueryResult } from './report';
import { aggregateResults } from './report';
import { buildAndWait } from './build';

/**
 * Benchmark orchestration:
 * 1. (Optional) Build a RAG index for the outline folder via the API and wait for completion
 * 2. Call POST /api/rag/retrieve for each benchmark query
 * 3. Evaluate recall and aggregate the results into a report
 *
 * `client` can be injected for tests; see `main` for the CLI entry point.
 */

export interface RunBenchmarkOptions {
  client: RagApiClient;
  namespace: string;
  dataset?: readonly BenchmarkQuery[];
  outlinePath?: string;
  build?: boolean;
  topK?: number;
  includeAnswer?: boolean;
  /** Records each retrieval flow (community/evidence counts, context, evidence previews) to debug recall anomalies. */
  verbose?: boolean;
  pollIntervalMs?: number;
  buildTimeoutMs?: number;
}

export interface BenchmarkOutcome {
  report: BenchmarkReport;
  results: PerQueryResult[];
}

export const runBenchmark = async (options: RunBenchmarkOptions): Promise<BenchmarkOutcome> => {
  const dataset = options.dataset ?? BENCHMARK_QUERIES;
  const includeAnswer = options.includeAnswer ?? false;

  if (options.build === true) {
    if (!options.outlinePath) {
      throw new Error('outlinePath is required when build is enabled');
    }
    await buildAndWait(options.client, {
      namespace: options.namespace,
      outlinePath: options.outlinePath,
      ...(options.pollIntervalMs !== undefined ? { pollIntervalMs: options.pollIntervalMs } : {}),
      ...(options.buildTimeoutMs !== undefined ? { buildTimeoutMs: options.buildTimeoutMs } : {}),
    });
  }

  const results: PerQueryResult[] = [];
  for (const query of dataset) {
    const topK = options.topK ?? query.topK;
    const retrieved = await retrieveOrThrow(options, query, topK);
    const context = buildRetrievedContext(retrieved, { includeAnswer });
    const evaluation = evaluateRecall(context, query.expectation);
    if (options.verbose === true) {
      logRetrievalFlow(query.id, retrieved, context, evaluation);
    }
    results.push({ query, evaluation });
  }

  return { report: aggregateResults(results), results };
};

const retrieveOrThrow = async (
  options: RunBenchmarkOptions,
  query: BenchmarkQuery,
  topK: number,
): Promise<RetrievalResult> => {
  try {
    return await options.client.retrieve({
      query: query.query,
      topK,
      namespace: options.namespace,
    });
  } catch (error) {
    if (options.verbose === true) {
      console.error(`[retrieve] ${query.id} FAILED: ${(error as Error).message}`);
    }
    throw error;
  }
};

const logRetrievalFlow = (
  id: string,
  retrieved: RetrievalResult,
  context: string,
  evaluation: QueryEvaluation,
): void => {
  console.log(
    `[retrieve] ${id} · communities=${retrieved.communities.length} evidence=${retrieved.evidence.length} ` +
      `context=${context.length} chars · entityRecall=${evaluation.entityRecall} phraseRecall=${evaluation.phraseRecall}`,
  );
  for (const [index, snippet] of retrieved.evidence.entries()) {
    console.log(`  evidence[${index}]: ${snippet.text.replace(/\s+/g, ' ').slice(0, 120)}`);
  }
};

export interface CliOptions {
  baseUrl: string;
  namespace: string;
  outlinePath: string;
  build: boolean;
  includeAnswer: boolean;
  verbose: boolean;
  topK: number | undefined;
}

const valueOf = (argv: readonly string[], flag: string): string | undefined => {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
};

const parseTopK = (argv: readonly string[]): number | undefined => {
  const raw = valueOf(argv, '--topK');
  if (raw === undefined) {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const parseCliOptions = (
  argv: readonly string[],
  env: Record<string, string | undefined>,
): CliOptions => ({
  baseUrl: valueOf(argv, '--base-url') ?? env.RAG_API_BASE_URL ?? 'http://localhost:3000',
  namespace: valueOf(argv, '--namespace') ?? env.RAG_NAMESPACE ?? 'default-namespace',
  outlinePath:
    valueOf(argv, '--outline') ??
    env.RAG_OUTLINE_PATH ??
    '/Users/dushihua/dev/story-wirter/output/retrospector/outline',
  build: argv.includes('--build'),
  includeAnswer: argv.includes('--include-answer'),
  verbose: argv.includes('--verbose'),
  topK: parseTopK(argv),
});

export const main = async (
  argv: readonly string[],
  env: Record<string, string | undefined>,
  clientFactory: (baseUrl: string) => RagApiClient = (baseUrl) =>
    createRagApiClient({ baseUrl }),
): Promise<void> => {
  const cli = parseCliOptions(argv, env);
  const outcome = await runBenchmark({
    client: clientFactory(cli.baseUrl),
    namespace: cli.namespace,
    outlinePath: cli.outlinePath,
    build: cli.build,
    includeAnswer: cli.includeAnswer,
    verbose: cli.verbose,
    ...(cli.topK !== undefined ? { topK: cli.topK } : {}),
  });
  console.log(formatMarkdownReport(outcome.report, outcome.results));
};

if (import.meta.main) {
  await main(process.argv.slice(2), process.env);
}
