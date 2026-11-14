import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import type { BuildRegistry } from '../../src/build/buildRegistry';
import { loadHarnessConfig } from '../../src/harness/config';
import { maskDatabaseUrl, planHarness } from '../../src/harness/plan';

const DEFAULT_CONFIG_PATH = './graphrag.harness.json';
const DEFAULT_NAMESPACE = 'demo';
const BUILD_POLL_INTERVAL_MS = 1_000;
const BUILD_MAX_ATTEMPTS = 300;

type CliCommand =
  | { mode: 'check'; configPath: string }
  | { mode: 'build'; configPath: string; directory: string; namespace: string }
  | { mode: 'query'; configPath: string; query: string; namespace: string };

/** The URL of the config currently in use, kept only so error output can be redacted. */
let activeDatabaseUrl: string | undefined;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const safeMessage = (error: unknown): string => {
  const message = errorMessage(error);
  return activeDatabaseUrl === undefined
    ? message
    : message.split(activeDatabaseUrl).join(maskDatabaseUrl(activeDatabaseUrl));
};

const requireArgValue = (value: string | undefined, message: string): string => {
  if (value === undefined || value.trim() === '') throw new Error(message);
  return value;
};

const parseCommand = (argv: string[]): CliCommand => {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      config: { type: 'string' },
      check: { type: 'boolean', default: false },
      build: { type: 'string' },
      query: { type: 'string' },
      namespace: { type: 'string' },
    },
  });

  const configPath = values.config ?? DEFAULT_CONFIG_PATH;
  const namespace = values.namespace ?? DEFAULT_NAMESPACE;
  const build = values.build;
  const query = values.query;

  const selected = [
    values.check ? 'check' : null,
    build === undefined ? null : 'build',
    query === undefined ? null : 'query',
  ].filter((mode): mode is string => mode !== null);

  if (selected.length > 1) {
    throw new Error('Use only one of --check, --build <dir> or --query <text>.');
  }

  const mode = selected[0] ?? 'check';

  if (mode === 'build') {
    return {
      mode: 'build',
      configPath,
      directory: requireArgValue(build, '--build requires a directory path.'),
      namespace,
    };
  }
  if (mode === 'query') {
    return {
      mode: 'query',
      configPath,
      query: requireArgValue(query, '--query requires a non-empty query string.'),
      namespace,
    };
  }
  return { mode: 'check', configPath };
};

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

const waitForBuild = async (id: string, registry: BuildRegistry): Promise<void> => {
  for (let attempt = 0; attempt < BUILD_MAX_ATTEMPTS; attempt += 1) {
    const job = registry.get(id);
    if (!job) throw new Error(`Build job '${id}' disappeared from the registry.`);
    if (job.status === 'succeeded') return;
    if (job.status === 'failed') throw new Error(`Build failed: ${job.error ?? 'unknown error'}`);
    await sleep(BUILD_POLL_INTERVAL_MS);
  }
  throw new Error(`Build job '${id}' did not finish within ${BUILD_MAX_ATTEMPTS}s.`);
};

const runCheck = async (command: { configPath: string }): Promise<void> => {
  const config = await loadHarnessConfig(command.configPath);
  activeDatabaseUrl = config.database.url;

  // Nothing but planning: no adapters registered, no database connection.
  const plan = await planHarness({ config, configPath: command.configPath });

  console.log(JSON.stringify(plan.summary, null, 2));
  console.log('OK');
};

const runBuild = async (command: {
  configPath: string;
  directory: string;
  namespace: string;
}): Promise<void> => {
  const config = await loadHarnessConfig(command.configPath);
  activeDatabaseUrl = config.database.url;

  const files = readMarkdownFiles(command.directory);
  if (files.length === 0) {
    throw new Error(`No Markdown files found under '${command.directory}'.`);
  }

  // Imported here (not at module scope) so `--check` never initialises Prisma or the model loader.
  const [{ applyHarness }, { createBuildRegistry }, { startBuild }] = await Promise.all([
    import('../../src/harness/apply'),
    import('../../src/build/buildRegistry'),
    import('../../src/build/startBuild'),
  ]);

  const applied = await applyHarness({ config, configPath: command.configPath });
  try {
    const registry = createBuildRegistry();
    const jobId = startBuild(files, registry, command.namespace);
    console.log(
      `job ${jobId}: indexing ${files.length} file(s) from '${command.directory}' into namespace '${command.namespace}'`,
    );

    await waitForBuild(jobId, registry);
    console.log(
      JSON.stringify(
        {
          job: jobId,
          status: 'succeeded',
          namespace: command.namespace,
          files: files.length,
          harness: applied.summary.harness,
        },
        null,
        2,
      ),
    );
  } finally {
    await applied.close();
  }
};

const runQuery = async (command: {
  configPath: string;
  query: string;
  namespace: string;
}): Promise<void> => {
  const config = await loadHarnessConfig(command.configPath);
  activeDatabaseUrl = config.database.url;

  const [{ applyHarness }, { GraphRAGRetrievalService }] = await Promise.all([
    import('../../src/harness/apply'),
    import('../../src/retrieval/service/GraphRAGRetrievalService'),
  ]);

  const applied = await applyHarness({ config, configPath: command.configPath });
  try {
    const service = new GraphRAGRetrievalService();
    const result = await service.retrieve({
      namespace: command.namespace,
      query: command.query,
    });

    console.log(`answer: ${result.answer}`);
    console.log(`evidence snippets: ${result.evidence.length}`);
  } finally {
    await applied.close();
  }
};

const main = async (): Promise<void> => {
  const command = parseCommand(process.argv.slice(2));

  if (command.mode === 'build') {
    await runBuild(command);
    return;
  }
  if (command.mode === 'query') {
    await runQuery(command);
    return;
  }
  await runCheck(command);
};

main().catch((error: unknown) => {
  console.error(safeMessage(error));
  process.exitCode = 1;
});
