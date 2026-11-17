import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.ts';
import { createJudge } from './integrity/judge.ts';
import { createLogger } from './log.ts';
import { createMcpServer, createQueryLimiter } from './mcp/tools.ts';
import { createStore } from './store.ts';

const main = async (): Promise<void> => {
  const config = loadConfig({
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://catalog:catalog@127.0.0.1:5432/catalog',
    MCP_TRANSPORT: 'stdio',
  });
  const logger = createLogger(config.LOG_LEVEL);
  const store = createStore(config.DATABASE_URL);
  const judge = createJudge(store.integrityStore);
  const server = createMcpServer(store, config, logger, createQueryLimiter(1), undefined, {
    integrity: { store: store.integrityStore, judge },
  });

  await server.connect(new StdioServerTransport());
  logger.info('Catalog/introspection mode is ready; no database is attached.');

  let stopping = false;
  const shutdown = (): void => {
    if (stopping) return;
    stopping = true;
    void server.close()
      .catch((error: unknown) => logger.error('Failed to close catalog MCP server.', {
        error_name: error instanceof Error ? error.name : 'UnknownError',
      }))
      .finally(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
};

main().catch((error: unknown) => {
  console.error(JSON.stringify({
    level: 'error',
    message: 'Catalog MCP server failed to start.',
    error_name: error instanceof Error ? error.name : 'UnknownError',
  }));
  process.exitCode = 1;
});
