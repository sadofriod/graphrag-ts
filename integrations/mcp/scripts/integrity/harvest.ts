import { createHash } from 'node:crypto';
import { mkdir, open, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeDoi, normalizeOpenAlexId } from './classify.ts';
import {
  fetchCitingWorks, fetchCrossref, fetchRetractionWatch,
  findRetractedWorks, openAlexEntityUri, parseRetractionWatchCsv,
  resolveWorks, semanticMinInterval, type CrossrefMessage, type OpenAlexWork, type RequestCounter, type RwRow,
} from './sources.ts';
import { cachedRetractionSeeds, createPaperCallbacks, gatherOpenCitations, referenceDeadline, resolveReferenceEntities, workFromCache } from './opencitations.ts';
import { semanticContexts, type ContextEdge } from './contexts.ts';
import { selectRetractionWatchRow } from './retractionwatch.ts';

type Options = { out: string; seeds: number; citing: number; snapshotId?: string; refresh: boolean; citingSource: 'openalex' | 'opencitations'; maxReferences: number; refConcurrency: number };
type Paper = OpenAlexWork & { id: string; referenced_works: string[] };
type WorkRow = Record<string, unknown>;
type CiteRow = ContextEdge;
type Counters = { openalex: RequestCounter; crossref: RequestCounter; semantic: RequestCounter; rw: RequestCounter; opencitations: RequestCounter; unresolvedCiting: number };
const usage = 'Usage: bun scripts/integrity/harvest.ts --out <dir> [--seeds 12] [--citing 60] [--citing-source openalex|opencitations] [--max-references 6000] [--ref-concurrency 6] [--snapshot-id <id>] [--refresh]';

const parseNumber = (value: string | undefined, fallback: number): number => {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`Invalid positive integer: ${value}`);
  return number;
};

const parseArgs = (argv: readonly string[]): Options => {
  const parsed: Options = {
    out: '', seeds: parseNumber(process.env.SEEDS, 12),
    citing: parseNumber(process.env.CITING_PER_SEED, 60), refresh: false,
    citingSource: 'openalex', maxReferences: 6000, refConcurrency: 6,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    index = parseOption(arg, argv, index, parsed);
  }
  if (!parsed.out) throw new Error(usage);
  return { out: parsed.out, seeds: parsed.seeds, citing: parsed.citing,
    ...(parsed.snapshotId ? { snapshotId: parsed.snapshotId } : {}), refresh: parsed.refresh,
    citingSource: parsed.citingSource, maxReferences: parsed.maxReferences, refConcurrency: parsed.refConcurrency };
};
const optionValue = (argv: readonly string[], index: number): string => {
  const value = argv[index + 1];
  if (!value) throw new Error(usage);
  return value;
};
const parseOption = (arg: string | undefined, argv: readonly string[], index: number, parsed: Options): number => {
  switch (arg) {
    case '--refresh': parsed.refresh = true; return index;
    case '--out': parsed.out = optionValue(argv, index); return index + 1;
    case '--seeds': parsed.seeds = parseNumber(optionValue(argv, index), parsed.seeds); return index + 1;
    case '--citing': parsed.citing = parseNumber(optionValue(argv, index), parsed.citing); return index + 1;
    case '--snapshot-id': parsed.snapshotId = optionValue(argv, index); return index + 1;
    case '--citing-source': {
      const source = optionValue(argv, index);
      if (source !== 'openalex' && source !== 'opencitations') throw new Error(usage);
      parsed.citingSource = source;
      return index + 1;
    }
    case '--max-references': parsed.maxReferences = parseNumber(optionValue(argv, index), parsed.maxReferences); return index + 1;
    case '--ref-concurrency': parsed.refConcurrency = parseNumber(optionValue(argv, index), parsed.refConcurrency); return index + 1;
    default: throw new Error(usage);
  }
};
const progress = (step: string, done: number, total: number): void => {
  process.stderr.write(`${JSON.stringify({ step, done, total })}\n`);
};
const snapshotIdNow = (date = new Date()): string => {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `ri-${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`;
};
const cachedRwCsv = async (options: Options, counter: RequestCounter): Promise<{ csv: string; sha256: string }> => {
  const cache = join(options.out, 'cache', 'retractionwatch.csv');
  let csv: string | undefined;
  if (!options.refresh) {
    try {
      await stat(cache);
      const cachedCsv = await Bun.file(cache).text();
      if (cachedCsv.split(/\r?\n/, 1)[0]?.replace(/^\uFEFF/, '').includes('Record ID')) csv = cachedCsv;
    } catch { /* missing or unreadable cache */ }
  }
  if (csv === undefined) {
    const email = process.env.RETRACTION_WATCH_EMAIL;
    if (!email) throw new Error('RETRACTION_WATCH_EMAIL is required to download Retraction Watch data.');
    await mkdir(join(options.out, 'cache'), { recursive: true });
    csv = await fetchRetractionWatch(email, counter);
    await atomicWrite(cache, csv);
  }
  return { csv, sha256: createHash('sha256').update(csv, 'utf8').digest('hex') };
};
const atomicWrite = async (path: string, content: string): Promise<void> => {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, content, 'utf8');
  await rename(temporary, path);
};
const jsonl = (rows: readonly Record<string, unknown>[], key: string): string =>
  `${[...rows].sort((left, right) => `${String(left[key] ?? '')}|${String(left.cited_id ?? left.source ?? '')}`.localeCompare(`${String(right[key] ?? '')}|${String(right.cited_id ?? right.source ?? '')}`)).map((row) => JSON.stringify(row)).join('\n')}\n`;

const paperRow = (work: Paper, fetchedAt: string): WorkRow => ({
  paper_id: normalizeOpenAlexId(work.id), doi: normalizeDoi(work.doi), title: work.title,
  publication_year: work.publication_year, venue: work.primary_location?.source?.display_name ?? null,
  cited_by_count: work.cited_by_count ?? null, openalex_is_retracted: Boolean(work.is_retracted),
  source_uri: work.id, source_tier: 'C', extraction_confidence: 1.0, fetched_at: fetchedAt,
  reference_ids: work.referenced_works.map((id) => normalizeOpenAlexId(id)).filter(Boolean), reference_count: work.referenced_works.length,
});
const paperFromCacheRow = (row: Record<string, unknown>): Paper => {
  const id = String(row.paper_id ?? '');
  const venue = typeof row.venue === 'string' ? row.venue : null;
  const references = Array.isArray(row.reference_ids) ? row.reference_ids.map(String) : [];
  return {
    id, doi: typeof row.doi === 'string' ? row.doi : null,
    title: typeof row.title === 'string' ? row.title : null,
    publication_year: typeof row.publication_year === 'number' ? row.publication_year : null,
    cited_by_count: typeof row.cited_by_count === 'number' ? row.cited_by_count : null,
    is_retracted: row.openalex_is_retracted === true,
    referenced_works: references.map((reference) => openAlexEntityUri(reference)),
    primary_location: venue ? { source: { display_name: venue } } : null,
  };
};
const loadWorksCache = async (out: string, papers: Map<string, Paper>): Promise<string> => {
  const cache = join(out, 'cache', 'works.jsonl');
  await mkdir(join(out, 'cache'), { recursive: true });
  try {
    const lines = (await Bun.file(cache).text()).split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line) continue;
      try {
        const row = JSON.parse(line) as Record<string, unknown>;
        const paper = paperFromCacheRow(row);
        if (!normalizeOpenAlexId(paper.id)) throw new Error('missing paper_id');
        ensurePaper(papers, paper);
      } catch (error) {
        process.stderr.write(`${JSON.stringify({ step: 'cache', warning: `Skipping malformed works cache line ${index + 1}: ${String(error)}` })}\n`);
      }
    }
  } catch { /* first run has no cache */ }
  process.stderr.write(`${JSON.stringify({ step: 'cache', papers: papers.size })}\n`);
  return cache;
};
const appendWorksCache = async (path: string, works: readonly Paper[]): Promise<void> => {
  if (!works.length) return;
  const fetchedAt = new Date().toISOString();
  const content = `${works.map((work) => JSON.stringify(paperRow(work, fetchedAt))).join('\n')}\n`;
  const write = async (): Promise<void> => {
    const file = await open(path, 'a');
    try { await file.writeFile(content, 'utf8'); await file.sync(); }
    finally { await file.close(); }
  };
  worksCacheWrite = worksCacheWrite.then(write);
  await worksCacheWrite;
};
let worksCacheWrite: Promise<void> = Promise.resolve();
const ensurePaper = (map: Map<string, Paper>, work: OpenAlexWork): Paper | undefined => {
  const id = normalizeOpenAlexId(work.id);
  if (!id) return undefined;
  const normalized: Paper = { ...work, id, referenced_works: work.referenced_works ?? [] };
  map.set(id, { ...map.get(id), ...normalized });
  return map.get(id);
};

const pageWorks = async (id: string, cap: number, counter: RequestCounter): Promise<OpenAlexWork[]> => {
  const works: OpenAlexWork[] = [];
  for (let page = 1; works.length < cap; page += 1) {
    const response = await fetchCitingWorks(id, page, counter);
    works.push(...response.results.slice(0, cap - works.length));
    if (response.results.length < 200 || works.length >= cap || page * 200 >= (response.meta?.count ?? Infinity)) break;
  }
  return works;
};

const chooseSeeds = async (limit: number, rw: Map<string, RwRow[]>, counter: RequestCounter): Promise<OpenAlexWork[]> => {
  const seeds: OpenAlexWork[] = [];
  for (let page = 1; page <= 3 && seeds.length < limit; page += 1) {
    const response = await findRetractedWorks(page, counter);
    for (const work of response.results) {
      if (normalizeDoi(work.doi) && selectRetractionWatchRow(rw.get(normalizeDoi(work.doi) as string) ?? [])?.is_retracted) seeds.push(work);
      if (seeds.length >= limit) break;
    }
  }
  return seeds;
};

const makeCite = (citing: string, cited: string, doi: string | null, uri: string, chunk: string | null): CiteRow => ({
  citing_id: citing, cited_id: cited, cited_doi: doi, source_tier: 'C', source_uri: uri,
  source_chunk_id: chunk, extraction_confidence: 1.0,
});

const gatherWorksAndEdges = async (seeds: OpenAlexWork[], options: Options, papers: Map<string, Paper>, counter: RequestCounter): Promise<{ citations: Map<string, OpenAlexWork[]>; edges: CiteRow[]; sourcePaperIds: Set<string>; unresolvedCiting: number }> => {
  const citations = new Map<string, OpenAlexWork[]>();
  const edges: CiteRow[] = [];
  const sourcePaperIds = new Set<string>();
  for (let index = 0; index < seeds.length; index += 1) {
    const seed = seeds[index];
    if (!seed) continue;
    const seedId = normalizeOpenAlexId(seed.id);
    if (!seedId) continue;
    ensurePaper(papers, seed);
    sourcePaperIds.add(seedId);
    const works = await pageWorks(seedId, options.citing, counter);
    citations.set(seedId, works);
    for (const work of works) {
      const paper = ensurePaper(papers, work);
      if (paper) { sourcePaperIds.add(paper.id); edges.push(makeCite(paper.id, seedId, normalizeDoi(seed.doi), work.id, null)); }
    }
    progress('citing', index + 1, seeds.length);
  }
  return { citations, edges, sourcePaperIds, unresolvedCiting: 0 };
};

const resolveBatch = async (batch: readonly string[], papers: Map<string, Paper>, resolved: Set<string>, skipped: string[], cache: string, counter: RequestCounter, deadline: number): Promise<void> => {
  if (Date.now() >= deadline) { skipped.push(...batch); return; }
  let response;
  try {
    response = await resolveWorks(batch, counter);
  } catch {
    if (batch.length === 1) { skipped.push(batch[0] ?? ''); return; }
    const midpoint = Math.ceil(batch.length / 2);
    await resolveBatch(batch.slice(0, midpoint), papers, resolved, skipped, cache, counter, deadline);
    await resolveBatch(batch.slice(midpoint), papers, resolved, skipped, cache, counter, deadline);
    return;
  }
  const resolvedWorks: Paper[] = [];
  for (const work of response.results) {
    const paper = ensurePaper(papers, work);
    if (paper) { resolved.add(paper.id); resolvedWorks.push(paper); }
  }
  await appendWorksCache(cache, resolvedWorks);
};

const maxRunMinutes = (): number => {
  const configured = Number(process.env.MAX_RUN_MINUTES ?? 45);
  return Number.isFinite(configured) && configured > 0 ? configured : 45;
};

const resolveReferences = async (papers: Map<string, Paper>, cache: string, counter: RequestCounter, startedAt: number): Promise<{ resolved: Set<string>; skipped: string[] }> => {
  const references = new Set<string>();
  for (const paper of papers.values()) for (const id of paper.referenced_works) {
    const normalized = normalizeOpenAlexId(id);
    if (normalized) references.add(normalized);
  }
  const ids = [...references].filter((id) => !papers.has(id));
  const resolved = new Set([...references].filter((id) => papers.has(id)));
  const skipped: string[] = [];
  const deadline = startedAt + maxRunMinutes() * 60_000;
  for (let offset = 0; offset < ids.length; offset += 100) {
    if (Date.now() >= deadline) {
      const remaining = ids.slice(offset);
      skipped.push(...remaining);
      process.stderr.write(`${JSON.stringify({ step: 'references', stopped: 'max_run_minutes' })}\n`);
      break;
    }
    const batch = ids.slice(offset, offset + 100);
    await resolveBatch(batch, papers, resolved, skipped, cache, counter, deadline);
    if (Date.now() >= deadline && offset + batch.length < ids.length) {
      const remaining = ids.slice(offset + batch.length);
      skipped.push(...remaining);
      process.stderr.write(`${JSON.stringify({ step: 'references', stopped: 'max_run_minutes' })}\n`);
      break;
    }
    progress('references', Math.min(offset + batch.length, ids.length), ids.length);
  }
  return { resolved, skipped };
};

const addReferenceEdges = (papers: Map<string, Paper>, resolved: Set<string>, edges: CiteRow[]): void => {
  for (const paper of papers.values()) for (const reference of paper.referenced_works) {
    const cited = normalizeOpenAlexId(reference);
    if (!cited || !resolved.has(cited)) continue;
    edges.push(makeCite(paper.id, cited, normalizeDoi(papers.get(cited)?.doi), `https://openalex.org/${paper.id}`, null));
  }
};

const formatDate = (parts?: number[][]): string | null => {
  const values = parts?.[0];
  if (!values?.[0]) return null;
  const [year, month = 1, day = 1] = values;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const retractionRows = async (papers: Map<string, Paper>, rw: Map<string, RwRow[]>, counter: RequestCounter): Promise<WorkRow[]> => {
  const rows: WorkRow[] = [];
  const observedAt = new Date().toISOString();
  for (const paper of papers.values()) {
    const doi = normalizeDoi(paper.doi);
    const rwNotice = doi ? selectRetractionWatchRow(rw.get(doi) ?? []) : undefined;
    if (rwNotice) rows.push({ paper_id: paper.id, doi, source: 'retraction_watch', source_tier: 'A', is_retracted: rwNotice.is_retracted, retraction_date: rwNotice.date, reason: rwNotice.reason, nature: rwNotice.nature, source_uri: 'https://api.labs.crossref.org/data/retractionwatch', source_chunk_id: null, observed_at: observedAt });
    if (rwNotice || paper.is_retracted) rows.push({ paper_id: paper.id, doi, source: 'openalex', source_tier: 'C', is_retracted: Boolean(paper.is_retracted), source_uri: `https://openalex.org/${paper.id}`, source_chunk_id: null, observed_at: observedAt });
  }
  const targetDois = [...new Set([...papers.values()].filter((paper) => {
    const doi = normalizeDoi(paper.doi);
    return Boolean(doi && ((rw.get(doi)?.length ?? 0) > 0 || paper.is_retracted));
  }).map((paper) => normalizeDoi(paper.doi) as string))];
  const targets = targetDois.slice(0, 150).map((doi) => [...papers.values()].find((paper) => normalizeDoi(paper.doi) === doi)).filter((paper): paper is Paper => Boolean(paper));
  counter.maxRequests = 150;
  for (let index = 0; index < targets.length; index += 1) {
    if (counter.count >= 150) {
      process.stderr.write(`Crossref limit reached: skipped ${targetDois.length - index} remaining DOI lookups.\n`);
      break;
    }
    const paper = targets[index];
    if (!paper) continue;
    const doi = normalizeDoi(paper.doi);
    if (!doi) continue;
    try {
      const message = (await fetchCrossref(doi, counter)).message;
      rows.push(crossrefRow(paper, doi, message, observedAt));
    } catch (error) { process.stderr.write(`Crossref failed for ${doi}: ${String(error)}\n`); }
  }
  return rows;
};

const crossrefRow = (paper: Paper, doi: string, message: CrossrefMessage | undefined, observedAt: string): WorkRow => {
  const entry = message?.['updated-by']?.find((item) => item.type === 'retraction');
  return { paper_id: paper.id, doi, source: 'crossref', source_tier: 'A', is_retracted: Boolean(entry), retraction_date: formatDate(entry?.updated?.['date-parts']), reason: null, nature: entry?.label ?? null, source_uri: `https://api.crossref.org/works/${encodeURIComponent(doi)}`, source_chunk_id: entry?.['record-id'] ?? null, observed_at: observedAt };
};

const counters = (): Counters => ({ openalex: { count: 0 }, crossref: { count: 0 }, semantic: { count: 0 }, rw: { count: 0 }, opencitations: { count: 0 }, unresolvedCiting: 0 });

const writeSnapshot = async (options: Options, papers: Map<string, Paper>, edges: CiteRow[], retractions: WorkRow[], seeds: OpenAlexWork[], rwRows: RwRow[], sha256: string, calls: Counters, skipped: string[], contextsFailed: number): Promise<void> => {
  const snapshotId = options.snapshotId ?? snapshotIdNow();
  const parent = join(options.out, 'snapshots');
  const directory = join(parent, snapshotId);
  const temporary = join(parent, `.${snapshotId}.tmp-${process.pid}`);
  await mkdir(parent, { recursive: true });
  await rm(temporary, { recursive: true, force: true });
  await mkdir(temporary, { recursive: true });
  const paperRows = [...papers.values()].map((paper) => paperRow(paper, new Date().toISOString()));
  const uniqueEdges = [...new Map(edges.map((edge) => [`${edge.citing_id}|${edge.cited_id}`, edge])).values()];
  const uniqueRetractions = [...new Map(retractions.map((row) => [`${row.paper_id}|${row.source}`, row])).values()];
  const manifest = { snapshot_id: snapshotId, built_at: new Date().toISOString(), seeds: seeds.map((seed) => normalizeOpenAlexId(seed.id)).filter(Boolean), counts: { papers: paperRows.length, cites: uniqueEdges.length, retractions: uniqueRetractions.length, contexts: uniqueEdges.filter((edge) => edge.context_snippet).length }, sources: { openalex: { requests: calls.openalex.count, skipped_reference_batches: skipped, ...(options.citingSource === 'opencitations' ? { unresolved_citing: calls.unresolvedCiting } : {}) }, ...(options.citingSource === 'opencitations' ? { opencitations: { requests: calls.opencitations.count } } : {}), retraction_watch: { requests: calls.rw.count, rows: rwRows.length, sha256 }, crossref: { requests: calls.crossref.count }, semantic_scholar: { requests: calls.semantic.count } }, params: { max_depth: 2, citing_per_seed: options.citing, seeds: options.seeds, refresh: options.refresh, ...(options.citingSource === 'opencitations' ? { citing_source: options.citingSource, max_references: options.maxReferences, ref_concurrency: options.refConcurrency } : {}), semantic_min_interval_ms: semanticMinInterval(), semantic_max_pages: semanticMaxPages() }, contexts_failed: contextsFailed };
  try {
    await atomicWrite(join(temporary, 'papers.jsonl'), jsonl(paperRows, 'paper_id'));
    await atomicWrite(join(temporary, 'cites.jsonl'), jsonl(uniqueEdges, 'citing_id'));
    await atomicWrite(join(temporary, 'retractions.jsonl'), jsonl(uniqueRetractions, 'paper_id'));
    await atomicWrite(join(temporary, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    await rename(temporary, directory);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

const run = async (options: Options): Promise<void> => {
  const startedAt = Date.now();
  process.stderr.write(`${JSON.stringify({ step: 'auth', openalex_api_key: Boolean(process.env.OPENALEX_API_KEY) })}\n`);
  const snapshotOptions = { ...options, snapshotId: options.snapshotId ?? snapshotIdNow() };
  const calls = counters();
  const papers = new Map<string, Paper>();
  const worksCache = await loadWorksCache(options.out, papers);
  const rwFile = await cachedRwCsv(snapshotOptions, calls.rw);
  const rw = parseRetractionWatchCsv(rwFile.csv);
  const result = await harvestGraph(options, snapshotOptions, rw.byDoi, papers, worksCache, calls, startedAt);
  const { seeds, graph, references } = result;
  const edges = graph.edges;
  addReferenceEdges(papers, references.resolved, edges);
  const contextsFailed = await runSemanticIfEnabled(seeds, graph.citations, edges, calls.semantic);
  const retractions = await retractionRows(papers, rw.byDoi, calls.crossref);
  await writeSnapshot(snapshotOptions, papers, edges, retractions, seeds, rw.rows, rwFile.sha256, calls, references.skipped, contextsFailed);
  const snapshotId = snapshotOptions.snapshotId;
  console.log(JSON.stringify({ snapshot_id: snapshotId, papers: papers.size, cites: edges.length, retractions: retractions.length, skipped_references: references.skipped.length, contexts_failed: contextsFailed, sources: { openalex: calls.openalex.count, ...(calls.openalex.lastOpenAlexRateLimit?.remainingUsd || calls.openalex.lastOpenAlexRateLimit?.reset ? { openalex_rate_limit: { ...(calls.openalex.lastOpenAlexRateLimit.remainingUsd ? { 'x-ratelimit-remaining-usd': calls.openalex.lastOpenAlexRateLimit.remainingUsd } : {}), ...(calls.openalex.lastOpenAlexRateLimit.reset ? { 'x-ratelimit-reset': calls.openalex.lastOpenAlexRateLimit.reset } : {}) } } : {}), ...(options.citingSource === 'opencitations' ? { opencitations: { requests: calls.opencitations.count }, unresolved_citing: calls.unresolvedCiting } : {}), retraction_watch: { rows: rw.rows.length, sha256: rwFile.sha256 }, crossref: calls.crossref.count, semantic_scholar: calls.semantic.count } }));
};

const harvestGraph = async (options: Options, snapshotOptions: Options, rw: Map<string, RwRow[]>, papers: Map<string, Paper>, cache: string, calls: Counters, startedAt: number) => {
  const seeds = await selectSeeds(options, rw, papers, calls.openalex);
  const graph = await gatherGraph(options, snapshotOptions, seeds, papers, cache, calls);
  const references = await resolveGraphReferences(options, papers, graph, cache, calls.openalex, startedAt);
  calls.unresolvedCiting = options.citingSource === 'opencitations' ? graph.unresolvedCiting : 0;
  return { seeds, graph, references };
};

const selectSeeds = (options: Options, rw: Map<string, RwRow[]>, papers: Map<string, Paper>, counter: RequestCounter): Promise<OpenAlexWork[]> | OpenAlexWork[] =>
  options.citingSource === 'openalex' ? chooseSeeds(options.seeds, rw, counter) : cachedRetractionSeeds(papers, options.seeds).map(workFromCache);

const gatherGraph = (options: Options, snapshotOptions: Options, seeds: OpenAlexWork[], papers: Map<string, Paper>, cache: string, calls: Counters) =>
  options.citingSource === 'openalex'
    ? gatherWorksAndEdges(seeds, snapshotOptions, papers, calls.openalex)
    : gatherOpenCitations(seeds, options.citing, paperCallbacks(papers, cache), calls.openalex, calls.opencitations);

const resolveGraphReferences = (options: Options, papers: Map<string, Paper>, graph: Awaited<ReturnType<typeof gatherGraph>>, cache: string, counter: RequestCounter, startedAt: number) =>
  options.citingSource === 'openalex'
    ? resolveReferences(papers, cache, counter, startedAt)
    : resolveReferenceEntities(papers, graph.sourcePaperIds, options.maxReferences, options.refConcurrency, referenceDeadline(startedAt, maxRunMinutes()), counter, paperCallbacks(papers, cache));

const runSemanticIfEnabled = (seeds: OpenAlexWork[], citations: Map<string, OpenAlexWork[]>, edges: CiteRow[], counter: RequestCounter): Promise<number> =>
  process.env.SEMANTIC_ENABLED?.toLowerCase() === 'false' ? Promise.resolve(0) : semanticContexts(seeds, citations, edges, counter);

const paperCallbacks = createPaperCallbacks;

if (import.meta.main) {
  try { await run(parseArgs(Bun.argv.slice(2))); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
