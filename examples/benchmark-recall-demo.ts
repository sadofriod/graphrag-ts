/**
 * Build a long Markdown corpus and report recall@k for GraphRAG retrieval.
 *
 * Usage:
 *   bun run demo:benchmark
 *
 * Optional environment overrides:
 *   RAG_DEMO_NAMESPACE
 *   RAG_DEMO_OUTLINE_PATH
 *   RAG_DEMO_TOPK
 *   RAG_DEMO_SKIP_BUILD=true   // re-use the existing GraphRAG build and only run retrieval
 *   RAG_DEMO_INCLUDE_ANSWER=true
 */
import { buildRAG } from '../src/build/buildRag';
import { createBuildRegistry } from '../src/build/buildRegistry';
import { envModelConfigs, injectModelConfigs } from '../src/build/modelLoader';
import { startBuild } from '../src/build/startBuild';
import { withNamespace } from '../src/namespace/namespaceContext';
import { GraphRAGRetrievalService } from '../src/retrieval/service/GraphRAGRetrievalService';
import {
  DEFAULT_LONG_CORPUS_DIR,
  describeCorpus,
  prepareLongMarkdownCorpus,
  readMarkdownFiles,
} from './benchmark-recall/corpus';
import { RECALL_QUERIES } from './benchmark-recall/dataset';
import { buildRetrievedContext, evaluateRecall } from './benchmark-recall/evaluation';
import { aggregateResults, formatMarkdownReport } from './benchmark-recall/report';
import type { PerQueryResult, RecallQuery, Retrieve } from './benchmark-recall/types';

export interface RecallDemoOptions {
  readonly namespace?: string;
  readonly outlinePath?: string;
  readonly dataset?: readonly RecallQuery[];
  readonly queryIds?: readonly string[];
  readonly topK?: number;
  readonly includeAnswer?: boolean;
  readonly buildTimeoutMs?: number;
  readonly skipBuild?: boolean;
  readonly retrieve?: Retrieve;
  readonly debugTopK?: number;
}

const DEFAULT_NAMESPACE = 'demo-long-markdown-recall';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const waitForBuild = async (
  id: string,
  registry: ReturnType<typeof createBuildRegistry>,
  timeoutMs: number,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = registry.get(id);
    if (!job) {
      throw new Error(`build ${id} not found`);
    }
    if (job.status === 'succeeded') {
      return;
    }
    if (job.status === 'failed') {
      throw new Error(`build failed: ${job.error ?? 'unknown error'}`);
    }
    if (Date.now() > deadline) {
      throw new Error(`build timed out after ${timeoutMs}ms`);
    }
    await sleep(1000);
  }
};

const buildLongMarkdownIndex = async (
  namespace: string,
  outlinePath: string,
  timeoutMs: number,
): Promise<string> => {
  const files = readMarkdownFiles(outlinePath);
  if (files.length === 0) {
    throw new Error(`No markdown files found under ${outlinePath}`);
  }

  const registry = createBuildRegistry();
  const buildId = startBuild(files, registry, namespace, {
    runner: async (inputFiles, targetNamespace) => buildRAG(inputFiles, targetNamespace),
  });
  await waitForBuild(buildId, registry, timeoutMs);
  return buildId;
};

const runRecallQueries = async (options: {
  readonly dataset: readonly RecallQuery[];
  readonly topK?: number;
  readonly includeAnswer?: boolean;
  readonly retrieve: Retrieve;
}): Promise<PerQueryResult[]> => {
  const results: PerQueryResult[] = [];
  for (const query of options.dataset) {
    const retrieved = await options.retrieve({ query: query.query, topK: options.topK ?? query.topK });
    const context = buildRetrievedContext(
      retrieved,
      options.includeAnswer === undefined ? {} : { includeAnswer: options.includeAnswer },
    );
    results.push({ query, evaluation: evaluateRecall(context, query.expectation) });
  }
  return results;
};

export const runRecallBenchmarkDemo = async (options: RecallDemoOptions = {}) => {
  const namespace = options.namespace ?? DEFAULT_NAMESPACE;
  const outlinePath = options.outlinePath ?? DEFAULT_LONG_CORPUS_DIR;
  const selectedQueryIds = options.queryIds;
  const dataset = (options.dataset ?? RECALL_QUERIES).filter(
    (query) => selectedQueryIds === undefined || selectedQueryIds.includes(query.id),
  );

  const corpusDir = options.skipBuild ? outlinePath : await prepareLongMarkdownCorpus(outlinePath);
  const buildId = options.skipBuild
    ? (process.env.RAG_DEMO_BUILD_ID ?? 'reused-existing-build')
    : await buildLongMarkdownIndex(
        namespace,
        corpusDir,
        options.buildTimeoutMs ?? 15 * 60 * 1000,
      );
  const service = new GraphRAGRetrievalService();
  const retrieve = options.retrieve ?? ((input) => service.retrieve(input));
  const results = await withNamespace(namespace, () =>
    runRecallQueries({
      dataset,
      retrieve,
      ...(options.topK !== undefined ? { topK: options.topK } : {}),
      ...(options.includeAnswer !== undefined ? { includeAnswer: options.includeAnswer } : {}),
    }),
  );

  return { buildId, namespace, corpusDir, report: aggregateResults(results), results };
};

const printDiagnosticSnippets = async (options: RecallDemoOptions): Promise<void> => {
  const namespace = options.namespace ?? DEFAULT_NAMESPACE;
  const dataset = (options.dataset ?? RECALL_QUERIES).filter(
    (query) => options.queryIds === undefined || options.queryIds.includes(query.id),
  );

  if (dataset.length === 0) {
    console.log('No matching benchmark queries found for diagnosis.');
    return;
  }

  const service = new GraphRAGRetrievalService();
  const retrieve = options.retrieve ?? ((input) => service.retrieve(input));
  const debugTopK = options.debugTopK ?? options.topK ?? 5;

  for (const query of dataset) {
    const result = await withNamespace(namespace, () =>
      retrieve({ query: query.query, topK: debugTopK }),
    );

    console.log(`\n=== Diagnostic: ${query.id} ===`);
    console.log(`Source: ${query.source}`);
    console.log(`Focus: ${query.focus}`);
    console.log(`Query: ${query.query}`);
    console.log(`Retrieved communities (${result.communities.length}):`);
    for (const community of result.communities.slice(0, 5)) {
      console.log(
        `  - ${community.name ?? '(unnamed)'} | score=${community.score.toFixed(4)} | members=${(community.members ?? []).slice(0, 8).join(', ')}`,
      );
    }
    console.log(`Evidence snippets (top ${Math.min(result.evidence.length, debugTopK)}):`);
    for (const [index, evidence] of result.evidence.slice(0, debugTopK).entries()) {
      const text = evidence.text.replace(/\s+/g, ' ').trim();
      console.log(`  [${index + 1}] ${text.slice(0, 500)}${text.length > 500 ? '...' : ''}`);
    }
    if (result.evidence.length === 0) {
      console.log('  (no evidence returned)');
    }
  }
};

const parseTopK = (value: string | undefined): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const parseQueryIds = (value: string | undefined): readonly string[] | undefined => {
  if (!value) {
    return undefined;
  }
  const ids = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : undefined;
};

const parsePositiveInteger = (value: string | undefined): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const main = async (): Promise<void> => {
  await injectModelConfigs(envModelConfigs());

  const outlinePath = process.env.RAG_DEMO_OUTLINE_PATH ?? DEFAULT_LONG_CORPUS_DIR;
  const topK = parseTopK(process.env.RAG_DEMO_TOPK);
  const buildTimeoutMs = parsePositiveInteger(process.env.RAG_DEMO_BUILD_TIMEOUT_MS);
  const debugTopK = parseTopK(process.env.RAG_DEMO_DEBUG_TOPK);
  const queryIds = parseQueryIds(process.env.RAG_DEMO_QUERY_IDS);
  const skipBuild = process.env.RAG_DEMO_SKIP_BUILD === 'true';
  const demoOptions: RecallDemoOptions = {
    namespace: process.env.RAG_DEMO_NAMESPACE ?? DEFAULT_NAMESPACE,
    outlinePath,
    includeAnswer: process.env.RAG_DEMO_INCLUDE_ANSWER === 'true',
    skipBuild,
    ...(queryIds !== undefined ? { queryIds } : {}),
    ...(topK !== undefined ? { topK } : {}),
    ...(buildTimeoutMs !== undefined ? { buildTimeoutMs } : {}),
    ...(debugTopK !== undefined ? { debugTopK } : {}),
  };

  if (queryIds !== undefined || process.env.RAG_DEMO_DEBUG_SAMPLES === 'true') {
    await printDiagnosticSnippets(demoOptions);
    return;
  }

  const demo = await runRecallBenchmarkDemo(demoOptions);

  console.log('Recall demo command:');
  console.log('  bun run demo:benchmark');
  console.log(`corpus: ${await describeCorpus(demo.corpusDir)}`);
  console.log(`buildId: ${demo.buildId}`);
  console.log(`namespace: ${demo.namespace}`);
  console.log(formatMarkdownReport(demo.report, demo.results));
};

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
