import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { envModelConfigs, injectGraphRAG } from '@ashes_born/graph-rag-ts';
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
  const models = envModelConfigs();
  const configuredModelTypes = new Set<string>(models.map((model) => model.type));
  const missingModelTypes = ['slice', 'judge', 'embedding'].filter((type) => !configuredModelTypes.has(type));
  if (missingModelTypes.length > 0) {
    throw new Error(`Missing GraphRAG model configuration for: ${missingModelTypes.join(', ')}.`);
  }

  process.once('SIGINT', () => shutdown.abort());
  process.once('SIGTERM', () => shutdown.abort());

  try {
    await store.ensureGraphSchema();
    await store.migrate();
    await prisma.$connect();
    await injectGraphRAG({ database: { client: prisma }, models });
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