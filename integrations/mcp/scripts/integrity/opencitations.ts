import { appendFile, mkdir, open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { normalizeDoi, normalizeOpenAlexId } from './classify.ts';
import { fetchCitingDois, fetchWorkByDoi, fetchWorkById, openAlexEntityUri, type OpenAlexWork, type OpenCitationsCiting, type RequestCounter } from './sources.ts';

export type HarvestPaper = OpenAlexWork & { id: string; referenced_works: string[] };
export type HarvestCite = Record<string, unknown> & { citing_id: string; cited_id: string };
export type GraphResult = { citations: Map<string, OpenAlexWork[]>; edges: HarvestCite[]; sourcePaperIds: Set<string>; unresolvedCiting: number };
export type PaperCallbacks = { register: (work: OpenAlexWork) => HarvestPaper | undefined; persist: (paper: HarvestPaper) => Promise<void> };

export const createPaperCallbacks = (papers: Map<string, HarvestPaper>, cache: string): PaperCallbacks => ({
  register: (work) => {
    const id = normalizeOpenAlexId(work.id);
    if (!id) return undefined;
    const paper: HarvestPaper = { ...work, id, referenced_works: work.referenced_works ?? [] };
    papers.set(id, { ...papers.get(id), ...paper });
    return papers.get(id);
  },
  persist: (paper) => appendCachedPaper(cache, paper),
});

let cacheWrite = Promise.resolve();

const appendCachedPaper = async (cache: string, paper: HarvestPaper): Promise<void> => {
  const row = { paper_id: normalizeOpenAlexId(paper.id), doi: normalizeDoi(paper.doi), title: paper.title, publication_year: paper.publication_year, venue: paper.primary_location?.source?.display_name ?? null, cited_by_count: paper.cited_by_count ?? null, openalex_is_retracted: Boolean(paper.is_retracted), source_uri: paper.id, source_tier: 'C', extraction_confidence: 1.0, fetched_at: new Date().toISOString(), reference_ids: (paper.referenced_works ?? []).map((id) => normalizeOpenAlexId(id)).filter(Boolean), reference_count: (paper.referenced_works ?? []).length };
  const write = async (): Promise<void> => {
    await mkdir(dirname(cache), { recursive: true });
    await appendFile(cache, `${JSON.stringify(row)}\n`, 'utf8');
    const file = await open(cache, 'r');
    try { await file.sync(); } finally { await file.close(); }
  };
  cacheWrite = cacheWrite.then(write);
  await cacheWrite;
};

export const cachedRetractionSeeds = (papers: Map<string, HarvestPaper>, limit: number): OpenAlexWork[] => {
  const seeds = [...papers.values()].filter((paper) => paper.is_retracted)
    .sort((left, right) => (right.cited_by_count ?? 0) - (left.cited_by_count ?? 0)).slice(0, limit);
  if (!seeds.length) throw new Error('No retracted works with OpenAlex flags found in cache/works.jsonl.');
  return seeds.map((paper) => ({ ...paper, id: openAlexEntityUri(paper.id) }));
};

export const workFromCache = (paper: HarvestPaper): OpenAlexWork => ({ ...paper, id: openAlexEntityUri(paper.id) });

export const gatherOpenCitations = async (seeds: OpenAlexWork[], cap: number, callbacks: PaperCallbacks, openalex: RequestCounter, opencitations: RequestCounter): Promise<GraphResult> => {
  const result: GraphResult = { citations: new Map(), edges: [], sourcePaperIds: new Set(), unresolvedCiting: 0 };
  for (let index = 0; index < seeds.length; index += 1) {
    const seed = seeds[index];
    const doi = normalizeDoi(seed?.doi);
    const seedId = normalizeOpenAlexId(seed?.id);
    if (!doi || !seedId) continue;
    result.sourcePaperIds.add(seedId);
    const identities = await fetchCitingDois(doi, opencitations);
    const lookup = await resolveCitingDois(identities.slice(0, cap), callbacks, openalex);
    const works = lookup.works;
    result.unresolvedCiting += lookup.unresolved;
    result.citations.set(seedId, works);
    for (const work of works) addCitingEdge(result, work, seedId, doi);
    process.stderr.write(`${JSON.stringify({ step: 'citing', done: index + 1, total: seeds.length })}\n`);
  }
  return result;
};

const resolveCitingDois = async (identities: OpenCitationsCiting[], callbacks: PaperCallbacks, counter: RequestCounter): Promise<{ works: OpenAlexWork[]; unresolved: number }> => {
  const works: OpenAlexWork[] = [];
  let unresolved = 0;
  for (const identity of identities) {
    try {
      const work = await lookupCitingWork(identity, counter);
      const paper = work ? callbacks.register(work) : undefined;
      if (!paper) { unresolved += 1; continue; }
      await callbacks.persist(paper);
      works.push(work as OpenAlexWork);
    } catch { unresolved += 1; }
  }
  return { works, unresolved };
};

const lookupCitingWork = async (identity: OpenCitationsCiting, counter: RequestCounter): Promise<OpenAlexWork | undefined> => {
  if (identity.doi) return fetchWorkByDoi(identity.doi, counter);
  if (identity.openalexId) return fetchWorkById(identity.openalexId, counter);
  return undefined;
};

const addCitingEdge = (result: GraphResult, work: OpenAlexWork, seedId: string, doi: string): void => {
  const paperId = normalizeOpenAlexId(work.id);
  if (!paperId) return;
  result.sourcePaperIds.add(paperId);
  result.edges.push({ citing_id: paperId, cited_id: seedId, cited_doi: doi, source_tier: 'C', source_uri: openAlexEntityUri(work.id), source_chunk_id: null, extraction_confidence: 1.0 });
};

export const resolveReferenceEntities = async (papers: Map<string, HarvestPaper>, sourceIds: Set<string>, maxReferences: number, concurrency: number, deadline: number, counter: RequestCounter, callbacks: PaperCallbacks): Promise<{ resolved: Set<string>; skipped: string[] }> => {
  const references = getReferenceIds(papers, sourceIds);
  const ids = [...references].filter((id) => !papers.has(id)).slice(0, maxReferences);
  const resolved = new Set([...references].filter((id) => papers.has(id)));
  const skipped: string[] = [];
  const cursor = await resolveConcurrently(ids, papers, concurrency, deadline, counter, callbacks, resolved, skipped);
  skipped.push(...[...references].filter((id) => !papers.has(id) && !ids.includes(id)));
  if (Date.now() >= deadline && cursor < ids.length) {
    skipped.push(...ids.slice(cursor).filter((id) => !papers.has(id)));
    process.stderr.write(`${JSON.stringify({ step: 'references', stopped: 'max_run_minutes' })}\n`);
  }
  return { resolved, skipped: [...new Set(skipped)] };
};

export const referenceDeadline = (startedAt: number, maxMinutes: number): number => startedAt + maxMinutes * 60_000;

const getReferenceIds = (papers: Map<string, HarvestPaper>, sourceIds: Set<string>): Set<string> => {
  const ids = new Set<string>();
  for (const sourceId of sourceIds) for (const reference of papers.get(sourceId)?.referenced_works ?? []) {
    const id = normalizeOpenAlexId(reference);
    if (id) ids.add(id);
  }
  return ids;
};

const resolveConcurrently = async (ids: string[], papers: Map<string, HarvestPaper>, concurrency: number, deadline: number, counter: RequestCounter, callbacks: PaperCallbacks, resolved: Set<string>, skipped: string[]): Promise<number> => {
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < ids.length && Date.now() < deadline) {
      const id = ids[cursor++];
      if (!id) continue;
      await resolveOne(id, callbacks, counter, resolved, skipped);
      if (cursor % concurrency === 0 || cursor === ids.length) process.stderr.write(`${JSON.stringify({ step: 'references', done: cursor, total: ids.length })}\n`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, () => worker()));
  return cursor;
};

const resolveOne = async (id: string, callbacks: PaperCallbacks, counter: RequestCounter, resolved: Set<string>, skipped: string[]): Promise<void> => {
  try {
    const work = await fetchWorkById(id, counter);
    const paper = callbacks.register(work);
    if (!paper) { skipped.push(id); return; }
    resolved.add(paper.id);
    await callbacks.persist(paper);
  } catch { skipped.push(id); }
};
