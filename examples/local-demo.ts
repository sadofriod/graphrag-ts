#!/usr/bin/env bun

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createBuildRegistry } from '../src/build/buildRegistry';
import { envModelConfigs, injectModelConfigs } from '../src/build/modelLoader';
import { startBuild } from '../src/build/startBuild';
import { withNamespace } from '../src/namespace/namespaceContext';
import { GraphRAGRetrievalService } from '../src/retrieval/service/GraphRAGRetrievalService';
import type { RetrievalResult } from '../src/retrieval/types/retrieval';

const CORPUS_DIR = new URL('./sample-corpus', import.meta.url).pathname;
const REPORT_DIR = new URL('./output/', import.meta.url).pathname;
const NAMESPACE = process.env.RAG_DEMO_NAMESPACE ?? 'local-demo';
const LOCAL_QUERY =
  process.env.RAG_LOCAL_QUERY ?? 'What does the limited reset actually shut down?';
const GLOBAL_QUERY =
  process.env.RAG_GLOBAL_QUERY ?? 'What is the overall story of the Glass Archive?';

const setLocal = (name: string, value: string): void => {
  process.env[name] = value;
};

const configureLocalModels = (): void => {
  const chatModel = process.env.RAG_LOCAL_CHAT_MODEL ?? 'google/gemma-4-12b';
  setLocal('RAG_SLICE_PROVIDER', 'openai');
  setLocal('RAG_SLICE_API_KEY', 'lm-studio');
  setLocal('RAG_SLICE_MODEL', chatModel);
  setLocal('RAG_SLICE_BASE_URL', 'http://127.0.0.1:1234/v1');
  setLocal('RAG_JUDGE_PROVIDER', 'openai');
  setLocal('RAG_JUDGE_API_KEY', 'lm-studio');
  setLocal('RAG_JUDGE_MODEL', chatModel);
  setLocal('RAG_JUDGE_BASE_URL', 'http://127.0.0.1:1234/v1');
  setLocal('RAG_EMBED_PROVIDER', 'openai');
  setLocal('RAG_EMBED_API_KEY', 'lm-studio');
  setLocal('RAG_EMBED_MODEL', 'text-embedding-nomic-embed-text-v1.5');
  setLocal('RAG_EMBED_BASE_URL', 'http://127.0.0.1:1234/v1');
};

const readMarkdownFiles = (dir: string): Array<{ title: string; content: string }> => {
  const files: Array<{ title: string; content: string }> = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...readMarkdownFiles(fullPath));
    } else if (entry.endsWith('.md')) {
      files.push({ title: entry, content: readFileSync(fullPath, 'utf8') });
    }
  }
  return files;
};

const waitForBuild = async (
  id: string,
  registry: ReturnType<typeof createBuildRegistry>,
): Promise<void> => {
  for (;;) {
    const job = registry.get(id);
    if (!job) throw new Error(`build ${id} not found`);
    if (job.status === 'succeeded') return;
    if (job.status === 'failed') throw new Error(`build failed: ${job.error ?? 'unknown error'}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
};

const normalizeAnswer = (answer: string, evidence: string): string => {
  const trimmed = answer.trim();
  if (trimmed) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'answer' in parsed &&
        typeof parsed.answer === 'string'
      ) {
        return parsed.answer;
      }
    } catch {
      return trimmed;
    }
    return trimmed;
  }
  return evidence ? `No generated answer. Top evidence: ${evidence}` : 'No answer generated.';
};

const formatResult = (label: string, result: RetrievalResult): string => {
  const communities = result.communities
    .slice(0, 3)
    .map((community) => `${community.name} (${community.score.toFixed(2)})`)
    .join(', ');
  const evidence = result.evidence
    .slice(0, 2)
    .map((item) => item.text.replace(/\s+/g, ' ').trim().slice(0, 220))
    .map((text) => `- ${text}`)
    .join('\n');
  const answerPreview = result.evidence[0]?.text.replace(/\s+/g, ' ').trim().slice(0, 240) ?? '';

  return [
    `## ${label}`,
    '',
    `Query: ${result.query}`,
    '',
    `Communities: ${communities || '(none)'}`,
    `Evidence: ${result.evidence.length} snippets`,
    '',
    'Answer:',
    normalizeAnswer(result.answer, answerPreview),
    '',
    'Evidence preview:',
    evidence || '- (none)',
    '',
  ].join('\n');
};

const main = async (): Promise<void> => {
  const startedAt = Date.now();
  configureLocalModels();
  await injectModelConfigs(envModelConfigs());

  const files = readMarkdownFiles(CORPUS_DIR);
  if (process.env.RAG_DEMO_BUILD === 'true') {
    const registry = createBuildRegistry();
    const buildId = startBuild(files, registry, NAMESPACE, { incremental: true });
    await waitForBuild(buildId, registry);
    console.log(`Indexed ${files.length} files into ${NAMESPACE}.`);
  }

  const service = new GraphRAGRetrievalService();
  const [local, global] = await withNamespace(NAMESPACE, async () =>
    Promise.all([
      service.retrieve({ query: LOCAL_QUERY, topK: 4 }),
      service.retrieve({ query: GLOBAL_QUERY, topK: 4 }),
    ]),
  );
  const elapsedMs = Date.now() - startedAt;
  const report = [
    '# GraphRAG LM Studio Local Demo',
    '',
    `- Namespace: ${NAMESPACE}`,
    `- Model: ${process.env.RAG_SLICE_MODEL}`,
    `- Elapsed: ${(elapsedMs / 1000).toFixed(1)}s`,
    '',
    formatResult('Local', local),
    formatResult('Global', global),
  ].join('\n');

  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(join(REPORT_DIR, 'local-demo.md'), `${report}\n`, 'utf8');
  console.log(`\n${report}`);
  console.log(`Report: ${join(REPORT_DIR, 'local-demo.md')}`);
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});