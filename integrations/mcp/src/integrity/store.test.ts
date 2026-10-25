import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import type { Pool } from 'pg';
import { createIntegrityStore, mapCiteRow, mapPaperRow, mapRetractionRow } from './store.ts';

type Script = { readonly match: RegExp; readonly rows?: readonly unknown[]; readonly rowCount?: number | null };
const scriptedPool = (clientScripts: Script[], poolScripts: Script[] = []) => {
  const calls: string[] = [];
  const run = async (scripts: Script[], sql: string): Promise<{ rows: unknown[]; rowCount: number | null }> => {
    calls.push(sql.trim().split(/\s+/u).slice(0, 4).join(' '));
    const next = scripts.shift();
    if (!next || !next.match.test(sql)) throw new Error(`Unexpected SQL: ${sql}`);
    return { rows: [...(next.rows ?? [])], rowCount: next.rowCount ?? null };
  };
  const client = { query: (sql: string) => run(clientScripts, sql), release: () => undefined };
  const pool = { connect: async () => client, query: (sql: string) => run(poolScripts, sql) };
  return { pool: pool as unknown as Pool, calls };
};

const paperRow = {
  paper_id: 'W1', doi: '10.1/x', title: 'Paper', publication_year: 2001, venue: null, cited_by_count: 2,
  openalex_is_retracted: false, source_uri: 'https://openalex.example/W1', source_tier: 'C' as const,
  extraction_confidence: '0.9', fetched_at: '2025-01-01T00:00:00Z', reference_ids: '["W2"]', reference_count: 1,
};
const manifest = { snapshot_id: 'snap-1', built_at: '2025-01-01T00:00:00Z', seeds: [], counts: { papers: 1, cites: 1, retractions: 1, contexts: 0 }, sources: {}, params: {} };

describe('integrity storage mappers and snapshot load', () => {
  test('maps database representations and omits absent optional context', () => {
    expect(mapPaperRow(paperRow as Parameters<typeof mapPaperRow>[0])).toMatchObject({ paper_id: 'W1', extraction_confidence: 0.9, reference_ids: ['W2'] });
    expect(mapCiteRow({ citing_id: 'W1', cited_id: 'W2', cited_doi: null, source_tier: 'C', source_uri: 'uri', source_chunk_id: null, extraction_confidence: '1', context_snippet: null, context_class: null, context_source_tier: null, context_source_uri: null })).not.toHaveProperty('context_class');
    expect(mapRetractionRow({ paper_id: 'W1', doi: null, source: 'crossref', source_tier: 'A', is_retracted: true, source_uri: 'uri', source_chunk_id: null, observed_at: '2025-01-01', retraction_date: null, reason: null, nature: null })).not.toHaveProperty('reason');
  });

  test('loads rows in a single ordered transaction and activates the snapshot', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'integrity-store-'));
    try {
      await Promise.all([
        writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest)),
        writeFile(join(directory, 'papers.jsonl'), `${JSON.stringify(paperRow)}\n`),
        writeFile(join(directory, 'cites.jsonl'), `${JSON.stringify({ citing_id: 'W1', cited_id: 'W2', cited_doi: null, source_tier: 'C', source_uri: 'edge', source_chunk_id: null, extraction_confidence: 1 })}\n`),
        writeFile(join(directory, 'retractions.jsonl'), `${JSON.stringify({ paper_id: 'W2', doi: null, source: 'crossref', source_tier: 'A', is_retracted: true, source_uri: 'notice', source_chunk_id: null, observed_at: '2025-01-01' })}\n`),
      ]);
      const scripts: Script[] = [
        { match: /^BEGIN/ }, { match: /INSERT INTO integrity_snapshots/ }, { match: /INSERT INTO integrity_papers/ },
        { match: /INSERT INTO integrity_cites/ }, { match: /INSERT INTO integrity_retractions/ },
        { match: /UPDATE integrity_snapshots SET is_active=false/ }, { match: /UPDATE integrity_snapshots SET is_active=true/ }, { match: /^COMMIT/ },
      ];
      const scripted = scriptedPool(scripts);
      const result = await createIntegrityStore(scripted.pool).loadSnapshot(directory);
      expect(result).toEqual({ snapshot_id: 'snap-1', papers: 1, cites: 1, retractions: 1 });
      expect(scripted.calls.map((call) => call.split(' ')[0])).toEqual(['BEGIN', 'INSERT', 'INSERT', 'INSERT', 'INSERT', 'UPDATE', 'UPDATE', 'COMMIT']);
      expect(scripts).toHaveLength(0);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
