import { loadConfig } from './config.ts';
import { createStore } from './store.ts';

const main = async (): Promise<void> => {
  const config = loadConfig();
  const store = createStore(config.DATABASE_URL);
  try {
    await store.ensureGraphSchema();
    await store.migrate();
  } finally {
    await store.close();
  }
};

main().catch((error: unknown) => {
  console.error(JSON.stringify({
    level: 'error',
    message: error instanceof Error ? error.message : 'GraphRAG schema validation failed.',
  }));
  process.exitCode = 1;
});