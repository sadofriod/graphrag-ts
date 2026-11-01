import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { applyHarness, envModelConfigs, injectGraphRAG, loadHarnessConfig } from '@ashes_born/graph-rag-ts';
import { loadConfig } from './config.ts';
import { createLogger } from './log.ts';
import { startMcpServer } from './mcp.ts';
import { createStore } from './store.ts';
import { runWorker } from './worker.ts';

const main = async (): Promise<void> => {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);
  const store = createStore(config.DATABASE_URL);
  const prisma = new PrismaClient({ datasourceUrl: config.DATABASE_URL });
  const shutdown = new AbortController();
  const harnessConfigPath = config.HARNESS_CONFIG;
  // HARNESS_CONFIG replaces the RAG_* model variables; the database always comes from DATABASE_URL.
  const envModels = harnessConfigPath === undefined ? envModelConfigs() : null;
  if (envModels !== null) {
    const configuredModelTypes = new Set<string>(envModels.map((model) => model.type));
    const missingModelTypes = ['slice', 'judge', 'embedding'].filter((type) => !configuredModelTypes.has(type));
    if (missingModelTypes.length > 0) {
      throw new Error(`Missing GraphRAG model configuration for: ${missingModelTypes.join(', ')}.`);
    }
  }

  process.once('SIGINT', () => shutdown.abort());
  process.once('SIGTERM', () => shutdown.abort());

  try {
    await store.ensureGraphSchema();
    await store.migrate();
    await prisma.$connect();
    if (envModels !== null) {
      await injectGraphRAG({ database: { client: prisma }, models: envModels });
    } else {
      const harnessConfig = await loadHarnessConfig(harnessConfigPath);
      // prisma was created above from DATABASE_URL, so it is injected rather than owned:
      // the applied harness never disconnects it and the finally block below stays authoritative.
      const applied = await applyHarness({
        config: harnessConfig,
        configPath: harnessConfigPath,
        database: { client: prisma },
      });
      logger.info('Applied harness config.', {
        harness: applied.summary.harness,
        database_url: applied.summary.database.url,
        models: applied.summary.models.map(
          (model: { type: string; provider: string; model: string }) => ({
            type: model.type,
            provider: model.provider,
            model: model.model,
          }),
        ),
      });
    }
    const stopMcp = await startMcpServer(store, config, logger);
    const worker = runWorker(store, config, logger, shutdown.signal).catch((error: unknown) => {
      logger.error('Index worker stopped unexpectedly.', {
        error_name: error instanceof Error ? error.name : 'UnknownError',
      });
      shutdown.abort();
    });
    logger.info('GraphRAG MCP service is ready.');

    await new Promise<void>((resolve) => {
      if (shutdown.signal.aborted) {
        resolve();
        return;
      }
      shutdown.signal.addEventListener('abort', () => resolve(), { once: true });
    });
    await stopMcp();
    await worker;
  } finally {
    await prisma.$disconnect();
    await store.close();
  }
};

main().catch((error: unknown) => {
  console.error(JSON.stringify({
    level: 'error',
    message: 'GraphRAG MCP service failed to start.',
    error_name: error instanceof Error ? error.name : 'UnknownError',
  }));
  process.exitCode = 1;
});