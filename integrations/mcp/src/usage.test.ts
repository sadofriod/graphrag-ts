import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'bun:test';
import { Pool } from 'pg';
import { createUsageStore } from './usage.ts';

const databaseUrl = process.env.MCP_TEST_DATABASE_URL;

describe('PostgreSQL monthly admission ledger', () => {
  test.skipIf(!databaseUrl)('enforces concurrent limits, persists across pools and separates tenants/months', async () => {
    const schema = `test_mcp_usage_${randomUUID().replaceAll('-', '')}`;
    const admin = new Pool({ connectionString: databaseUrl });
    const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    const other = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    try {
      await admin.query(`CREATE SCHEMA ${schema}`);
      const migration = await readFile(new URL('../migrations/005_metered_access.sql', import.meta.url), 'utf8');
      await pool.query(migration);
      await pool.query(migration);
      const store = createUsageStore(pool);
      const secondStore = createUsageStore(other);
      await expect(store.consumeUsage('alpha', 'query', -1)).rejects.toThrow('Usage limits');
      const attempts = await Promise.all(Array.from({ length: 30 }, (_, index) =>
        (index % 2 ? store : secondStore).consumeUsage('alpha', 'query', 7),
      ));
      expect(attempts.filter(Boolean)).toHaveLength(7);
      expect((await secondStore.getUsage('alpha')).usage).toEqual([{ operation: 'query', units: 7 }]);
      expect(await store.consumeUsage('alpha', 'query', 3)).toBe(false);
      expect(await store.consumeUsage('alpha', 'query', 8)).toBe(true);
      expect(await store.consumeUsage('beta', 'query', 1)).toBe(true);
      expect(await store.consumeUsage('alpha', 'index', 1)).toBe(true);
      expect(await store.consumeUsage('alpha', 'global_query', 0)).toBe(false);
      await pool.query(`INSERT INTO mcp_usage VALUES
        ('alpha', (date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - interval '1 month')::date, 'query', 99)`);
      expect((await store.getUsage('alpha')).usage).toEqual([
        { operation: 'index', units: 1 }, { operation: 'query', units: 8 },
      ]);
      expect((await store.getUsage('empty')).usage).toEqual([]);
      expect((await store.getUsage('empty')).period).toMatch(/^\d{4}-\d{2}$/);
      await pool.end();
      expect(await secondStore.consumeUsage('alpha', 'query', 8)).toBe(false);
      expect((await secondStore.getUsage('alpha')).usage[1]?.units).toBe(8);
    } finally {
      if (!pool.ended) await pool.end();
      await other.end();
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  });
});
