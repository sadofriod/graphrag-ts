import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { loadConfig } from '../../integrations/mcp/src/config';
import { renderDelivery } from './export';
import { validateDataset } from './validate';

// Opt-in only: use a disposable database whose owner authorizes CREATE/DROP SCHEMA.
const enabled = process.env.WEB3_DATASET_POSTGRES_TEST === '1' || Boolean(process.env.WEB3_DATASET_TEST_DATABASE_URL);
type PgClient = {
  connect(): Promise<void>;
  query(sql: string): Promise<{ rows: readonly Record<string, unknown>[] }>;
  end(): Promise<void>;
};

test.skipIf(!enabled)('PostgreSQL round-trip, FK enforcement, and duplicate-load rollback', async () => {
  const url = process.env.WEB3_DATASET_TEST_DATABASE_URL ?? loadConfig().DATABASE_URL;
  const requireMcp = createRequire(new URL('../../integrations/mcp/package.json', import.meta.url));
  const { Client }: { Client: new (options: { connectionString: string }) => PgClient } = requireMcp('pg');
  const client = new Client({ connectionString: url });
  const namespace = `web3_test_${randomUUID().replaceAll('-', '')}`;
  const sample = validateDataset(JSON.parse(readFileSync(new URL('./sample.json', import.meta.url), 'utf8')));
  const title = "O'Brien \\notes\n雪'); DROP TABLE imaginary; --";
  const exported = renderDelivery({ ...sample, title }).get('dataset.sql') ?? '';
  const script = exported.replaceAll('web3_security_dataset', namespace);
  await client.connect();
  try {
    await client.query(script);
    const datasets = await client.query(`SELECT title FROM ${namespace}.datasets`);
    expect(datasets.rows[0]?.title).toBe(title);
    const entities = await client.query(`SELECT count(*)::int AS count FROM ${namespace}.entities`);
    expect(entities.rows[0]?.count).toBe(11);
    const sources = await client.query(`SELECT count(*)::int AS count FROM ${namespace}.relation_sources`);
    expect(sources.rows[0]?.count).toBe(13);
    await expect(client.query(`INSERT INTO ${namespace}.relations
      (dataset_id, id, kind, from_id, to_id) VALUES
      ('fictional-contract-safety', 'bad', 'depends_on', 'missing', 'd-loom')`)).rejects.toThrow();
    await expect(client.query(`INSERT INTO ${namespace}.entity_sources
      (dataset_id, entity_id, source_id) VALUES
      ('fictional-contract-safety', 'c-lumen', 'missing')`)).rejects.toThrow();
    await expect(client.query(script)).rejects.toThrow();
    await client.query('ROLLBACK');
    const retained = await client.query(`SELECT count(*)::int AS count FROM ${namespace}.datasets`);
    expect(retained.rows[0]?.count).toBe(1);
  } finally {
    await client.query('ROLLBACK');
    await client.query(`DROP SCHEMA IF EXISTS ${namespace} CASCADE`);
    await client.end();
  }
});
