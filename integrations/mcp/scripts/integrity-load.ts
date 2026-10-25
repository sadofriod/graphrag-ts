import { Pool } from 'pg';
import { createIntegrityStore } from '../src/integrity/store.ts';

const safeErrorMessage = (error: unknown, databaseUrl: string): string => {
  const message = error instanceof Error ? error.message : 'Unknown error.';
  return message.replaceAll(databaseUrl, '[redacted database URL]').replace(/postgres(?:ql)?:\/\/[^\s"']+/giu, '[redacted database URL]');
};

const main = async (): Promise<void> => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required to load an integrity snapshot.');
    process.exitCode = 2;
    return;
  }

  const snapshotDir = process.argv[2];
  if (!snapshotDir) {
    console.error('Usage: bun scripts/integrity-load.ts <snapshotDir>');
    process.exitCode = 2;
    return;
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  let failed = false;
  try {
    const result = await createIntegrityStore(pool).loadSnapshot(snapshotDir);
    console.log(JSON.stringify({ ...result, active: true }));
  } catch (error) {
    failed = true;
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    if (code === '42P01') {
      console.error('Run the service once so migrations 010/011 apply, then retry.');
      process.exitCode = 2;
    } else {
      console.error(`Snapshot load failed: ${safeErrorMessage(error, databaseUrl)}`);
      process.exitCode = 1;
    }
  } finally {
    try {
      await pool.end();
    } catch (error) {
      if (!failed) {
        console.error(`Could not close database pool: ${safeErrorMessage(error, databaseUrl)}`);
        process.exitCode = 1;
      }
    }
  }
};

await main();
