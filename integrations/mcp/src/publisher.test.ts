import { expect, test } from 'bun:test';
import type { PoolClient } from 'pg';
import { diffDocumentsWithExisting } from '@ashes_born/graph-rag-ts/incremental';
import { createPublisher } from './publisher.ts';
import { encodeSourceTitle, resolveSnapshotSources } from './snapshotSources.ts';
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

test('disambiguates # in source labels so updating the base label retains the # label', () => {
  const previous = [
    { id: 's1', sourceLabel: 'a.md', content: 'old base', contentHash: 'h1' },
    { id: 's2', sourceLabel: 'a.md#notes.md', content: 'unrelated notes', contentHash: 'h2' },
  ];
  const inputs = [
    { sourceLabel: 'a.md', content: 'new base', contentHash: 'h1-updated' },
  ];
  const { sources, changed } = resolveSnapshotSources(previous, inputs);
  expect(sources.map(({ sourceLabel }) => sourceLabel)).toEqual(['a.md', 'a.md#notes.md']);
  expect(changed.map(({ sourceLabel }) => sourceLabel)).toEqual(['a.md']);

  const diff = diffDocumentsWithExisting(
    changed.map((source) => ({
      title: encodeSourceTitle(source.sourceLabel),
      content: source.content,
    })),
    [
      { id: 'p-section-1', title: `${encodeSourceTitle('a.md')}#Intro`, content: 'old intro' },
      { id: 'p-hash', title: encodeSourceTitle('a.md#notes.md'), content: 'unrelated notes' },
    ],
  );

  expect(diff.toUpdate).toHaveLength(1);
  expect(diff.toUpdate[0]?.existingParentIds).toEqual(['p-section-1']);
});