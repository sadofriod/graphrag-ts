import { expect, test } from 'bun:test';
import type { PoolClient } from 'pg';
import { createPublisher } from './publisher.ts';
import type { Transaction } from './store.ts';

test('publishes only the latest version of each source', async () => {
  const linkedSources: unknown[] = [];
  const transaction: Transaction = async (operation) => operation({
    query: async (sql: string, values: readonly unknown[] = []) => {
      if (sql.includes('SELECT status')) {
        return { rows: [{ status: 'running', workspace_id: 'default' }] };
      }
      if (sql.includes('FROM knowledge_sources')) {
        return { rows: [
          { id: 'old', sourceLabel: 'policy.md', content: 'old policy', contentHash: 'old-hash' },
          { id: 'current', sourceLabel: 'policy.md', content: 'new policy', contentHash: 'new-hash' },
        ] };
      }
      if (sql.includes('INSERT INTO index_version_sources')) linkedSources.push(values[1]);
      return { rows: [] };
    },
  } as unknown as PoolClient);

  await createPublisher(transaction)('job', 'version', 'snapshot', 'default', ['old', 'current']);

  expect(linkedSources).toEqual(['current']);
});