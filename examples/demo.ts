/**
 * End-to-end demo: build the sample corpus into the graph, then run a retrieval.
 *
 * Requires a live PostgreSQL database with the schema applied (`bun run db:push`)
 * and model env vars configured (see `.env.example`).
 *
 * Usage: bun run examples/demo.ts
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { createBuildRegistry } from '../src/build/buildRegistry';
import { startBuild } from '../src/build/startBuild';
import { withNamespace } from '../src/namespace/namespaceContext';
import { GraphRAGRetrievalService } from '../src/retrieval/service/GraphRAGRetrievalService';

const CORPUS_DIR = new URL('./sample-corpus', import.meta.url).pathname;
const NAMESPACE = process.env.RAG_DEMO_NAMESPACE ?? 'demo';

const readMarkdownFiles = (dir: string): Array<{ title: string; content: string }> => {
  const files: Array<{ title: string; content: string }> = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry.endsWith('.md')) {
        files.push({ title: entry, content: readFileSync(full, 'utf8') });
      }
    }
  };
  walk(dir);
  return files;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const waitForBuild = async (
  id: string,
  registry: ReturnType<typeof createBuildRegistry>,
): Promise<void> => {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const job = registry.get(id);
    if (!job) throw new Error(`build ${id} not found`);
    if (job.status === 'succeeded') return;
    if (job.status === 'failed') throw new Error(`build failed: ${job.error}`);
    await sleep(1000);
  }
  throw new Error('build timed out');
};

const main = async (): Promise<void> => {
  const files = readMarkdownFiles(CORPUS_DIR);
  console.log(`indexing ${files.length} files from ${CORPUS_DIR}`);

  await withNamespace(NAMESPACE, async () => {
    const registry = createBuildRegistry();
    const id = startBuild(files, registry, NAMESPACE);
    await waitForBuild(id, registry);
    console.log('build succeeded');

    const service = new GraphRAGRetrievalService();
    const result = await service.retrieve({
      query: process.env.RAG_DEMO_QUERY ?? 'What does the limited reset actually shut down?',
      topK: 5,
    });
    console.log(`answer: ${result.answer}`);
    console.log(`evidence snippets: ${result.evidence.length}`);
  });
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
