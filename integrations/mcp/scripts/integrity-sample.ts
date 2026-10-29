import { Pool } from 'pg';
import { createJudge } from '../src/integrity/judge.ts';
import { createIntegrityStore } from '../src/integrity/store.ts';
import type { PaperRef } from '../src/integrity/judge.ts';

const paperRef = (input: string): PaperRef => {
  const doi = input.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  return /^10\.\d{4,9}\//i.test(doi) ? { doi } : { paper_id: input };
};

const main = async (): Promise<void> => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    process.stderr.write('DATABASE_URL is required.\n');
    process.exitCode = 2;
    return;
  }
  const inputs = process.argv.slice(2);
  if (!inputs.length) {
    process.stderr.write('Usage: bun scripts/integrity-sample.ts <doi-or-paper-id> [...]\n');
    process.exitCode = 2;
    return;
  }
  const pool = new Pool({ connectionString: databaseUrl });
  const judge = createJudge(createIntegrityStore(pool));
  try {
    for (const input of inputs) {
      const ref = paperRef(input);
      const status = await judge.paperStatus(ref);
      const propagation = await judge.retractionPropagation(ref);
      const audit = await judge.evidenceAudit(ref);
      process.stdout.write(`${JSON.stringify({ input, status, propagation, audit })}\n`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('No active integrity snapshot')) {
      process.stderr.write('No active integrity snapshot\n');
      process.exitCode = 1;
    } else {
      process.stderr.write(`Integrity sample failed: ${message.replaceAll(databaseUrl, '[redacted database URL]')}\n`);
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
};

await main();
