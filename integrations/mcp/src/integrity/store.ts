import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Pool, PoolClient } from 'pg';
import type { CiteEdge, CoverageRecord, JudgmentPayload, PaperRecord, RetractionPath, RetractionRecord, SnapshotManifest, SnapshotRecord, SourceTier } from './types.ts';

type PaperRow = Omit<PaperRecord, 'fetched_at' | 'reference_ids' | 'extraction_confidence'> & { fetched_at: Date | string; reference_ids: string[] | string; extraction_confidence: number | string };
type CiteRow = { citing_id: string; cited_id: string; cited_doi: string | null; source_tier: SourceTier; source_uri: string; source_chunk_id: string | null; extraction_confidence: number | string; context_snippet: string | null; context_class: CiteEdge['context_class'] | null; context_source_tier: SourceTier | null; context_source_uri: string | null };
type RetractionRow = Omit<RetractionRecord, 'observed_at' | 'retraction_date' | 'reason' | 'nature'> & { observed_at: Date | string; retraction_date: string | null; reason: string | null; nature: string | null };

export const mapPaperRow = (row: PaperRow): PaperRecord => ({
  ...row, fetched_at: row.fetched_at, reference_ids: typeof row.reference_ids === 'string' ? JSON.parse(row.reference_ids) as string[] : row.reference_ids,
  extraction_confidence: Number(row.extraction_confidence),
});

export const mapCiteRow = (row: CiteRow): CiteEdge => ({
  citing_id: row.citing_id, cited_id: row.cited_id, cited_doi: row.cited_doi, source_tier: row.source_tier,
  source_uri: row.source_uri, source_chunk_id: row.source_chunk_id, extraction_confidence: Number(row.extraction_confidence),
  ...(row.context_snippet === null ? {} : { context_snippet: row.context_snippet }),
  ...(row.context_class == null ? {} : { context_class: row.context_class }),
  ...(row.context_source_tier === null ? {} : { context_source_tier: row.context_source_tier }),
  ...(row.context_source_uri === null ? {} : { context_source_uri: row.context_source_uri }),
});

export const mapRetractionRow = (row: RetractionRow): RetractionRecord => ({
  paper_id: row.paper_id, doi: row.doi, source: row.source, source_tier: row.source_tier,
  is_retracted: row.is_retracted, source_uri: row.source_uri, source_chunk_id: row.source_chunk_id,
  observed_at: row.observed_at, ...(row.retraction_date === null ? {} : { retraction_date: row.retraction_date }),
  ...(row.reason === null ? {} : { reason: row.reason }), ...(row.nature === null ? {} : { nature: row.nature }),
});

const parseJsonl = async <T>(path: string): Promise<T[]> => {
  const content = await readFile(path, 'utf8');
  return content.split(/\r?\n/u).filter((line) => line.trim().length > 0).map((line) => JSON.parse(line) as T);
};

const insertSnapshot = async (client: PoolClient, manifest: SnapshotManifest): Promise<void> => {
  await client.query(
    'INSERT INTO integrity_snapshots (snapshot_id,built_at,manifest,is_active) VALUES ($1,$2,$3::jsonb,false) ON CONFLICT (snapshot_id) DO UPDATE SET built_at=EXCLUDED.built_at,manifest=EXCLUDED.manifest',
    [manifest.snapshot_id,manifest.built_at,JSON.stringify(manifest)],
  );
};

const deactivateSnapshots = async (client: PoolClient, snapshotId: string): Promise<void> => {
  await client.query('UPDATE integrity_snapshots SET is_active=false WHERE is_active=true AND snapshot_id<>$1', [snapshotId]);
  await client.query('UPDATE integrity_snapshots SET is_active=true WHERE snapshot_id=$1', [snapshotId]);
};

const loadSnapshotTransaction = async (pool: Pool, manifest: SnapshotManifest, rows: { papers: PaperRecord[]; cites: CiteEdge[]; retractions: RetractionRecord[] }): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await insertSnapshot(client, manifest);
    await upsertPapers(client, manifest.snapshot_id, rows.papers);
    await upsertCites(client, manifest.snapshot_id, rows.cites);
    await upsertRetractions(client, manifest.snapshot_id, rows.retractions);
    await deactivateSnapshots(client, manifest.snapshot_id);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
};

const upsertPaper = async (client: PoolClient, snapshotId: string, row: PaperRecord): Promise<void> => {
  await client.query(
    `INSERT INTO integrity_papers (snapshot_id, paper_id, doi, title, publication_year, venue, cited_by_count, openalex_is_retracted, source_uri, source_tier, extraction_confidence, fetched_at, reference_ids, reference_count)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14)
     ON CONFLICT (snapshot_id, paper_id) DO UPDATE SET doi=EXCLUDED.doi,title=EXCLUDED.title,publication_year=EXCLUDED.publication_year,venue=EXCLUDED.venue,cited_by_count=EXCLUDED.cited_by_count,openalex_is_retracted=EXCLUDED.openalex_is_retracted,source_uri=EXCLUDED.source_uri,source_tier=EXCLUDED.source_tier,extraction_confidence=EXCLUDED.extraction_confidence,fetched_at=EXCLUDED.fetched_at,reference_ids=EXCLUDED.reference_ids,reference_count=EXCLUDED.reference_count`,
    [snapshotId,row.paper_id,row.doi,row.title,row.publication_year,row.venue,row.cited_by_count,row.openalex_is_retracted,row.source_uri,row.source_tier,row.extraction_confidence,row.fetched_at,JSON.stringify(row.reference_ids),row.reference_count],
  );
};

const upsertPapers = async (client: PoolClient, snapshotId: string, rows: readonly PaperRecord[]): Promise<void> => {
  for (const row of rows) await upsertPaper(client, snapshotId, row);
};

const upsertCite = async (client: PoolClient, snapshotId: string, row: CiteEdge): Promise<void> => {
  await client.query(
    `INSERT INTO integrity_cites (snapshot_id,citing_id,cited_id,cited_doi,source_tier,source_uri,source_chunk_id,extraction_confidence,context_snippet,context_class,context_source_tier,context_source_uri)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (snapshot_id,citing_id,cited_id,source_uri,source_chunk_id) DO UPDATE SET cited_doi=EXCLUDED.cited_doi,source_tier=EXCLUDED.source_tier,extraction_confidence=EXCLUDED.extraction_confidence,context_snippet=EXCLUDED.context_snippet,context_class=EXCLUDED.context_class,context_source_tier=EXCLUDED.context_source_tier,context_source_uri=EXCLUDED.context_source_uri`,
    [snapshotId,row.citing_id,row.cited_id,row.cited_doi,row.source_tier,row.source_uri,row.source_chunk_id ?? '',row.extraction_confidence,row.context_snippet ?? null,row.context_class ?? null,row.context_source_tier ?? null,row.context_source_uri ?? null],
  );
};

const upsertCites = async (client: PoolClient, snapshotId: string, rows: readonly CiteEdge[]): Promise<void> => {
  for (const row of rows) await upsertCite(client, snapshotId, row);
};

const upsertRetraction = async (client: PoolClient, snapshotId: string, row: RetractionRecord): Promise<void> => {
  await client.query(
    `INSERT INTO integrity_retractions (snapshot_id,paper_id,doi,source,source_tier,is_retracted,retraction_date,reason,nature,source_uri,source_chunk_id,observed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (snapshot_id,paper_id,source,source_uri,source_chunk_id) DO UPDATE SET doi=EXCLUDED.doi,source_tier=EXCLUDED.source_tier,is_retracted=EXCLUDED.is_retracted,retraction_date=EXCLUDED.retraction_date,reason=EXCLUDED.reason,nature=EXCLUDED.nature,observed_at=EXCLUDED.observed_at`,
    [snapshotId,row.paper_id,row.doi,row.source,row.source_tier,row.is_retracted,row.retraction_date ?? null,row.reason ?? null,row.nature ?? null,row.source_uri,row.source_chunk_id ?? '',row.observed_at],
  );
};

const upsertRetractions = async (client: PoolClient, snapshotId: string, rows: readonly RetractionRecord[]): Promise<void> => {
  for (const row of rows) await upsertRetraction(client, snapshotId, row);
};

const normalizeDoi = (doi: string): string => doi.trim().replace(/^https?:\/\/doi\.org\//iu, '').toLowerCase();

const loadSnapshot = async (pool: Pool, dir: string): Promise<{ readonly snapshot_id: string; readonly papers: number; readonly cites: number; readonly retractions: number }> => {
  const manifest = JSON.parse(await readFile(`${dir}/manifest.json`, 'utf8')) as SnapshotManifest;
  const [papers,cites,retractions] = await Promise.all([
    parseJsonl<PaperRecord>(`${dir}/papers.jsonl`), parseJsonl<CiteEdge>(`${dir}/cites.jsonl`), parseJsonl<RetractionRecord>(`${dir}/retractions.jsonl`),
  ]);
  await loadSnapshotTransaction(pool, manifest, { papers, cites, retractions });
  return { snapshot_id: manifest.snapshot_id, papers: papers.length, cites: cites.length, retractions: retractions.length };
};

const coverage = async (pool: Pool, paperId: string): Promise<CoverageRecord> => {
  const result = await pool.query<{ reference_count: number | string; resolved: number | string }>(
    `SELECT jsonb_array_length(p.reference_ids) AS reference_count,
       count(r.paper_id)::int AS resolved
     FROM integrity_papers p JOIN integrity_snapshots s ON s.snapshot_id=p.snapshot_id AND s.is_active=true
     LEFT JOIN LATERAL jsonb_array_elements_text(p.reference_ids) ref(id) ON true
     LEFT JOIN integrity_papers r ON r.snapshot_id=p.snapshot_id AND r.paper_id=ref.id
     WHERE p.paper_id=$1 GROUP BY p.reference_ids`, [paperId],
  );
  const row = result.rows[0];
  const references = Number(row?.reference_count ?? 0); const resolved = Number(row?.resolved ?? 0);
  const indexed = references > 0 && resolved >= 0;
  return { references, resolved, ratio: indexed ? resolved / references : 0, indexed };
};

const pathsToRetracted = async (pool: Pool, paperId: string, maxDepth: number): Promise<readonly RetractionPath[]> => {
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 1) throw new Error('maxDepth must be a positive safe integer.');
  const result = await pool.query<{ paper_id: string; depth: number; edge_path: CiteRow[]; retraction_rows: RetractionRow[]; paper_row: PaperRow | null }>(
    `WITH RECURSIVE walk(node_id,depth,visited,edge_path) AS (
       SELECT c.cited_id,1,ARRAY[$2::text,c.cited_id]::text[],jsonb_build_array(to_jsonb(c)) FROM integrity_cites c JOIN integrity_snapshots s ON s.snapshot_id=c.snapshot_id AND s.is_active=true WHERE c.citing_id=$2 AND $1 >= 1
       UNION ALL
       SELECT c.cited_id,w.depth+1,w.visited||c.cited_id,w.edge_path||to_jsonb(c) FROM walk w JOIN integrity_cites c ON c.citing_id=w.node_id JOIN integrity_snapshots s ON s.snapshot_id=c.snapshot_id AND s.is_active=true WHERE w.depth<$1 AND NOT c.cited_id=ANY(w.visited)
     ), ranked AS (
       SELECT w.*,row_number() OVER (PARTITION BY w.node_id ORDER BY w.depth,w.edge_path::text) AS rank FROM walk w
       WHERE EXISTS (SELECT 1 FROM integrity_retractions r JOIN integrity_snapshots s ON s.snapshot_id=r.snapshot_id AND s.is_active=true WHERE r.paper_id=w.node_id AND r.is_retracted=true)
     )
     SELECT r.node_id AS paper_id,r.depth,r.edge_path,
        (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.source_tier DESC,x.source,x.source_uri) FROM integrity_retractions x JOIN integrity_snapshots sx ON sx.snapshot_id=x.snapshot_id AND sx.is_active=true WHERE x.paper_id=r.node_id) AS retraction_rows,
       (SELECT to_jsonb(p) FROM integrity_papers p JOIN integrity_snapshots sp ON sp.snapshot_id=p.snapshot_id AND sp.is_active=true WHERE p.paper_id=r.node_id LIMIT 1) AS paper_row
     FROM ranked r WHERE r.rank=1 ORDER BY r.depth,r.node_id`, [maxDepth,paperId],
  );
  return result.rows.map((row) => ({ paper: row.paper_row ? mapPaperRow(row.paper_row) : null, depth: row.depth,
    edges: (row.edge_path as unknown as CiteRow[]).map(mapCiteRow),
    retractions: (row.retraction_rows as unknown as RetractionRow[]).map(mapRetractionRow) }));
};

export const createIntegrityStore = (pool: Pool) => {
  const activeSnapshot = async (): Promise<SnapshotRecord | undefined> => {
    const result = await pool.query<{ snapshot_id: string; built_at: Date | string; manifest: SnapshotManifest }>('SELECT snapshot_id,built_at,manifest FROM integrity_snapshots WHERE is_active=true LIMIT 1');
    const row = result.rows[0];
    return row ? { id: row.snapshot_id, built_at: row.built_at, manifest: row.manifest } : undefined;
  };

  const findPaper = async (input: { readonly doi?: string; readonly paperId?: string }): Promise<PaperRecord | undefined> => {
    const doi = input.doi === undefined ? null : normalizeDoi(input.doi);
    const result = await pool.query<PaperRow>(
      `SELECT p.* FROM integrity_papers p JOIN integrity_snapshots s ON s.snapshot_id=p.snapshot_id
       WHERE s.is_active=true AND (($1::text IS NOT NULL AND lower(regexp_replace(p.doi, '^https?://doi\\.org/', '', 'i'))=$1) OR ($2::text IS NOT NULL AND p.paper_id=$2)) LIMIT 1`,
      [doi,input.paperId ?? null],
    );
    return result.rows[0] ? mapPaperRow(result.rows[0]) : undefined;
  };

  const retractionStatuses = async (paperIds: readonly string[]): Promise<ReadonlyMap<string, readonly RetractionRecord[]>> => {
    const result = await pool.query<RetractionRow>('SELECT r.* FROM integrity_retractions r JOIN integrity_snapshots s ON s.snapshot_id=r.snapshot_id AND s.is_active=true WHERE r.paper_id=ANY($1::text[]) ORDER BY r.paper_id,r.source_tier DESC,r.source', [paperIds]);
    const grouped = new Map<string, RetractionRecord[]>();
    for (const row of result.rows) grouped.set(row.paper_id, [...(grouped.get(row.paper_id) ?? []), mapRetractionRow(row)]);
    return grouped;
  };

  const dependencyContext = async (citingId: string, citedId: string): Promise<readonly CiteEdge[]> => {
    const result = await pool.query<CiteRow>('SELECT c.* FROM integrity_cites c JOIN integrity_snapshots s ON s.snapshot_id=c.snapshot_id AND s.is_active=true WHERE c.citing_id=$1 AND c.cited_id=$2 ORDER BY c.source_tier DESC,c.source_uri', [citingId,citedId]);
    return result.rows.map(mapCiteRow);
  };

  const dependencyContexts = async (citingId: string): Promise<readonly CiteEdge[]> => {
    const result = await pool.query<CiteRow>('SELECT c.* FROM integrity_cites c JOIN integrity_snapshots s ON s.snapshot_id=c.snapshot_id AND s.is_active=true WHERE c.citing_id=$1 ORDER BY c.cited_id,c.source_tier DESC,c.source_uri', [citingId]);
    return result.rows.map(mapCiteRow);
  };

  const recordJudgment = async (entry: { readonly snapshotId: string; readonly paperId: string | null; readonly inputRef: string; readonly judgmentType: string; readonly payload: JudgmentPayload }): Promise<void> => {
    await pool.query('INSERT INTO integrity_judgments (id,snapshot_id,paper_id,input_ref,judgment_type,payload) VALUES ($1,$2,$3,$4,$5,$6::jsonb)', [randomUUID(),entry.snapshotId,entry.paperId,entry.inputRef,entry.judgmentType,JSON.stringify(entry.payload)]);
  };

  const recentJudgments = async (limit: number): Promise<readonly { readonly id: string; readonly snapshot_id: string; readonly paper_id: string | null; readonly input_ref: string; readonly judgment_type: string; readonly payload: JudgmentPayload; readonly created_at: Date }[]> => {
    if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('Judgment limit must be a non-negative safe integer.');
    const result = await pool.query('SELECT id,snapshot_id,paper_id,input_ref,judgment_type,payload,created_at FROM integrity_judgments ORDER BY created_at DESC,id DESC LIMIT $1', [limit]);
    return result.rows;
  };

  return {
    loadSnapshot: (dir: string) => loadSnapshot(pool, dir), activeSnapshot, findPaper,
    coverage: (paperId: string) => coverage(pool, paperId),
    pathsToRetracted: (paperId: string, maxDepth: number) => pathsToRetracted(pool, paperId, maxDepth),
    retractionStatuses, dependencyContext, dependencyContexts, recordJudgment, recentJudgments,
  };
};

export type IntegrityStore = ReturnType<typeof createIntegrityStore>;
