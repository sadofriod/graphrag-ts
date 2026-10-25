import { createHash } from 'node:crypto';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { classifyContext, normalizeDoi, normalizeOpenAlexId } from './classify.ts';
import {
  fetchCitingWorks, fetchCrossref, fetchRetractionWatch, fetchSemanticPage, findRetractedWorks,
  resolveWorks, type CrossrefMessage, type OpenAlexWork, type RequestCounter, type SemanticCitation,
} from './sources.ts';

type Options = { out: string; seeds: number; citing: number; snapshotId?: string; refresh: boolean };
type CsvRow = Record<string, string>;
type Paper = OpenAlexWork & { id: string; referenced_works: string[] };
type WorkRow = Record<string, unknown>;
type CiteRow = Record<string, unknown> & { citing_id: string; cited_id: string };
type RwInfo = { date: string | null; reason: string | null; nature: string | null };
type Counters = { openalex: RequestCounter; crossref: RequestCounter; semantic: RequestCounter; rw: RequestCounter };

const usage = 'Usage: bun scripts/integrity/harvest.ts --out <dir> [--seeds 12] [--citing 60] [--snapshot-id <id>] [--refresh]';

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
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    index = parseOption(arg, argv, index, parsed);
  }
  if (!parsed.out) throw new Error(usage);
  return { out: parsed.out, seeds: parsed.seeds, citing: parsed.citing,
    ...(parsed.snapshotId ? { snapshotId: parsed.snapshotId } : {}), refresh: parsed.refresh };
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
    default: throw new Error(usage);
  }
};

const progress = (step: string, done: number, total: number): void => {
  process.stderr.write(`${JSON.stringify({ step, done, total })}\n`);
};

type CsvParserState = { rows: string[][]; row: string[]; field: string; quoted: boolean };

const finishCsvRow = (state: CsvParserState): void => {
  state.row.push(state.field);
  state.field = '';
  if (state.row.some((cell) => cell.length > 0)) state.rows.push(state.row);
  state.row = [];
};

const isEscapedQuote = (input: string, index: number, state: CsvParserState): boolean =>
  input[index] === '"' && state.quoted && input[index + 1] === '"';

const consumeCsvCharacter = (input: string, index: number, state: CsvParserState): number => {
  const char = input[index] ?? '';
  if (isEscapedQuote(input, index, state)) {
    state.field += '"';
    return index + 1;
  }
  if (char === '"') {
    state.quoted = !state.quoted;
    return index;
  }
  if (char === ',' && !state.quoted) {
    state.row.push(state.field);
    state.field = '';
    return index;
  }
  if ((char === '\n' || char === '\r') && !state.quoted) {
    if (char === '\r' && input[index + 1] === '\n') index += 1;
    finishCsvRow(state);
    return index;
  }
  state.field += char;
  return index;
};

const splitCsv = (input: string): string[][] => {
  const state: CsvParserState = { rows: [], row: [], field: '', quoted: false };
  for (let index = 0; index < input.length; index += 1) index = consumeCsvCharacter(input, index, state);
  if (state.field || state.row.length) {
    state.row.push(state.field);
    state.rows.push(state.row);
  }
  return state.rows;
};

const readRwRows = (csv: string): { rows: CsvRow[]; byDoi: Map<string, RwInfo> } => {
  const parsed = splitCsv(csv.replace(/^\uFEFF/, ''));
  const headers = parsed.shift() ?? [];
  const rows = parsed.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ''])));
  const byDoi = new Map<string, RwInfo>();
  for (const row of rows) {
    const doi = normalizeDoi(row.OriginalPaperDOI);
    if (doi) byDoi.set(doi, { date: row.RetractionDate || null, reason: row.Reason || null, nature: row.RetractionNature || null });
  }
  return { rows, byDoi };
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

const chooseSeeds = async (limit: number, rw: Map<string, RwInfo>, counter: RequestCounter): Promise<OpenAlexWork[]> => {
  const seeds: OpenAlexWork[] = [];
  for (let page = 1; page <= 3 && seeds.length < limit; page += 1) {
    const response = await findRetractedWorks(page, counter);
    for (const work of response.results) {
      if (normalizeDoi(work.doi) && rw.has(normalizeDoi(work.doi) as string)) seeds.push(work);
      if (seeds.length >= limit) break;
    }
  }
  return seeds;
};

const makeCite = (citing: string, cited: string, doi: string | null, uri: string, chunk: string | null): CiteRow => ({
  citing_id: citing, cited_id: cited, cited_doi: doi, source_tier: 'C', source_uri: uri,
  source_chunk_id: chunk, extraction_confidence: 1.0,
});

const gatherWorksAndEdges = async (seeds: OpenAlexWork[], options: Options, papers: Map<string, Paper>, counter: RequestCounter): Promise<{ citations: Map<string, OpenAlexWork[]>; edges: CiteRow[] }> => {
  const citations = new Map<string, OpenAlexWork[]>();
  const edges: CiteRow[] = [];
  for (let index = 0; index < seeds.length; index += 1) {
    const seed = seeds[index];
    if (!seed) continue;
    const seedId = normalizeOpenAlexId(seed.id);
    if (!seedId) continue;
    ensurePaper(papers, seed);
    const works = await pageWorks(seedId, options.citing, counter);
    citations.set(seedId, works);
    for (const work of works) {
      const paper = ensurePaper(papers, work);
      if (paper) edges.push(makeCite(paper.id, seedId, normalizeDoi(seed.doi), work.id, null));
    }
    progress('citing', index + 1, seeds.length);
  }
  return { citations, edges };
};

const resolveBatch = async (batch: readonly string[], papers: Map<string, Paper>, resolved: Set<string>, skipped: string[], counter: RequestCounter): Promise<void> => {
  try {
    const response = await resolveWorks(batch, counter);
    for (const work of response.results) {
      const paper = ensurePaper(papers, work);
      if (paper) resolved.add(paper.id);
    }
  } catch {
    if (batch.length === 1) { skipped.push(batch[0] ?? ''); return; }
    const midpoint = Math.ceil(batch.length / 2);
    await resolveBatch(batch.slice(0, midpoint), papers, resolved, skipped, counter);
    await resolveBatch(batch.slice(midpoint), papers, resolved, skipped, counter);
  }
};

const resolveReferences = async (papers: Map<string, Paper>, counter: RequestCounter): Promise<{ resolved: Set<string>; skipped: string[] }> => {
  const references = new Set<string>();
  for (const paper of papers.values()) for (const id of paper.referenced_works) {
    const normalized = normalizeOpenAlexId(id);
    if (normalized) references.add(normalized);
  }
  const ids = [...references].filter((id) => !papers.has(id));
  const resolved = new Set([...references].filter((id) => papers.has(id)));
  const skipped: string[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    await resolveBatch(batch, papers, resolved, skipped, counter);
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

const retractionRows = async (papers: Map<string, Paper>, rw: Map<string, RwInfo>, counter: RequestCounter): Promise<WorkRow[]> => {
  const rows: WorkRow[] = [];
  const observedAt = new Date().toISOString();
  for (const paper of papers.values()) {
    const doi = normalizeDoi(paper.doi);
    const rwInfo = doi ? rw.get(doi) : undefined;
    if (rwInfo) rows.push({ paper_id: paper.id, doi, source: 'retraction_watch', source_tier: 'A', is_retracted: true, retraction_date: rwInfo.date, reason: rwInfo.reason, nature: rwInfo.nature, source_uri: 'https://api.labs.crossref.org/data/retractionwatch', source_chunk_id: null, observed_at: observedAt });
    if (rwInfo || paper.is_retracted) rows.push({ paper_id: paper.id, doi, source: 'openalex', source_tier: 'C', is_retracted: Boolean(paper.is_retracted), source_uri: `https://openalex.org/${paper.id}`, source_chunk_id: null, observed_at: observedAt });
  }
  const targetDois = [...new Set([...papers.values()].filter((paper) => {
    const doi = normalizeDoi(paper.doi);
    return Boolean(doi && (rw.has(doi) || paper.is_retracted));
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

const addContext = (edge: CiteRow, snippet: string, doi: string): void => {
  edge.context_snippet = snippet.slice(0, 300);
  edge.context_class = classifyContext(snippet);
  edge.context_source_tier = 'B';
  edge.context_source_uri = `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}/citations`;
};

const semanticContexts = async (seeds: OpenAlexWork[], citations: Map<string, OpenAlexWork[]>, edges: CiteRow[], counter: RequestCounter): Promise<void> => {
  for (let index = 0; index < seeds.length; index += 1) {
    const seed = seeds[index];
    const doi = normalizeDoi(seed?.doi);
    const id = normalizeOpenAlexId(seed?.id);
    if (!doi || !id) continue;
    const works = citations.get(id) ?? [];
    if (!works.length) { progress('contexts', index + 1, seeds.length); continue; }
    const edgesByDoi = new Map<string, CiteRow>();
    for (const work of works) {
      const edge = edges.find((candidate) => candidate.cited_id === id && candidate.citing_id === normalizeOpenAlexId(work.id));
      const citingDoi = normalizeDoi(work.doi);
      if (edge && citingDoi) edgesByDoi.set(citingDoi, edge);
    }
    await readSemanticPages(doi, edgesByDoi, counter);
    progress('contexts', index + 1, seeds.length);
  }
};

const readSemanticPages = async (doi: string, edges: Map<string, CiteRow>, counter: RequestCounter): Promise<void> => {
  let offset = 0;
  while (true) {
    const page = await fetchSemanticPage(doi, offset, counter);
    for (const citation of page.data ?? []) applySemanticCitation(citation, edges, doi);
    if (page.next === undefined || page.next === null || [...edges.values()].every((edge) => edge.context_snippet)) break;
    offset = page.next;
  }
};

const applySemanticCitation = (citation: SemanticCitation, edges: Map<string, CiteRow>, doi: string): void => {
  const citingDoi = normalizeDoi(citation.citingPaper?.externalIds?.DOI);
  const snippet = citation.contexts?.[0];
  const edge = citingDoi ? edges.get(citingDoi) : undefined;
  if (edge && snippet) addContext(edge, snippet, doi);
};

const counters = (): Counters => ({ openalex: { count: 0 }, crossref: { count: 0 }, semantic: { count: 0 }, rw: { count: 0 } });

const writeSnapshot = async (options: Options, papers: Map<string, Paper>, edges: CiteRow[], retractions: WorkRow[], seeds: OpenAlexWork[], rwRows: CsvRow[], sha256: string, calls: Counters, skipped: string[]): Promise<void> => {
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
  const manifest = { snapshot_id: snapshotId, built_at: new Date().toISOString(), seeds: seeds.map((seed) => normalizeOpenAlexId(seed.id)).filter(Boolean), counts: { papers: paperRows.length, cites: uniqueEdges.length, retractions: uniqueRetractions.length, contexts: uniqueEdges.filter((edge) => edge.context_snippet).length }, sources: { openalex: { requests: calls.openalex.count, skipped_reference_batches: skipped }, retraction_watch: { requests: calls.rw.count, rows: rwRows.length, sha256 }, crossref: { requests: calls.crossref.count }, semantic_scholar: { requests: calls.semantic.count } }, params: { max_depth: 2, citing_per_seed: options.citing, seeds: options.seeds, refresh: options.refresh } };
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
  const snapshotOptions = { ...options, snapshotId: options.snapshotId ?? snapshotIdNow() };
  const calls = counters();
  const rwFile = await cachedRwCsv(snapshotOptions, calls.rw);
  const rw = readRwRows(rwFile.csv);
  const seeds = await chooseSeeds(options.seeds, rw.byDoi, calls.openalex);
  const papers = new Map<string, Paper>();
  const { edges, citations } = await gatherWorksAndEdges(seeds, snapshotOptions, papers, calls.openalex);
  const references = await resolveReferences(papers, calls.openalex);
  addReferenceEdges(papers, references.resolved, edges);
  await semanticContexts(seeds, citations, edges, calls.semantic);
  const retractions = await retractionRows(papers, rw.byDoi, calls.crossref);
  await writeSnapshot(snapshotOptions, papers, edges, retractions, seeds, rw.rows, rwFile.sha256, calls, references.skipped);
  const snapshotId = snapshotOptions.snapshotId;
  console.log(JSON.stringify({ snapshot_id: snapshotId, papers: papers.size, cites: edges.length, retractions: retractions.length, skipped_references: references.skipped.length, sources: { openalex: calls.openalex.count, retraction_watch: { rows: rw.rows.length, sha256: rwFile.sha256 }, crossref: calls.crossref.count, semantic_scholar: calls.semantic.count } }));
};

if (import.meta.main) {
  try { await run(parseArgs(Bun.argv.slice(2))); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
