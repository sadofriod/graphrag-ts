import { classifyContext, normalizeDoi, normalizeOpenAlexId } from './classify.ts';
import { fetchSemanticPage, type OpenAlexWork, type RequestCounter, type SemanticCitation } from './sources.ts';

export type ContextEdge = Record<string, unknown> & { citing_id: string; cited_id: string };

const maxPages = (): number => {
  const configured = Number(process.env.SEMANTIC_MAX_PAGES ?? 2);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : 2;
};

export const semanticContexts = async (seeds: OpenAlexWork[], citations: Map<string, OpenAlexWork[]>, edges: ContextEdge[], counter: RequestCounter): Promise<number> => {
  let failed = 0;
  for (let index = 0; index < seeds.length; index += 1) {
    const seed = seeds[index];
    const doi = normalizeDoi(seed?.doi);
    const id = normalizeOpenAlexId(seed?.id);
    if (!doi || !id) continue;
    failed += await collectSeedContexts(doi, id, citations.get(id) ?? [], edges, counter);
    process.stderr.write(`${JSON.stringify({ step: 'contexts', done: index + 1, total: seeds.length })}\n`);
  }
  return failed;
};

const collectSeedContexts = async (doi: string, id: string, works: OpenAlexWork[], edges: ContextEdge[], counter: RequestCounter): Promise<number> => {
  const edgesByDoi = indexEdges(id, works, edges);
  try { await readSemanticPages(doi, edgesByDoi, counter); return 0; }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ step: 'contexts', seed: id, error: message })}\n`);
    return 1;
  }
};

const indexEdges = (id: string, works: OpenAlexWork[], edges: ContextEdge[]): Map<string, ContextEdge> => {
  const byDoi = new Map<string, ContextEdge>();
  for (const work of works) {
    const edge = edges.find((candidate) => candidate.cited_id === id && candidate.citing_id === normalizeOpenAlexId(work.id));
    const doi = normalizeDoi(work.doi);
    if (edge && doi) byDoi.set(doi, edge);
  }
  return byDoi;
};

const readSemanticPages = async (doi: string, edges: Map<string, ContextEdge>, counter: RequestCounter): Promise<void> => {
  let offset = 0;
  for (let page = 0; page < maxPages(); page += 1) {
    const response = await fetchSemanticPage(doi, offset, counter);
    for (const citation of response.data ?? []) applyCitation(citation, edges, doi);
    if (response.next == null || [...edges.values()].every((edge) => edge.context_snippet)) break;
    offset = response.next;
  }
};

const applyCitation = (citation: SemanticCitation, edges: Map<string, ContextEdge>, doi: string): void => {
  const citingDoi = normalizeDoi(citation.citingPaper?.externalIds?.DOI);
  const snippet = citation.contexts?.[0];
  const edge = citingDoi ? edges.get(citingDoi) : undefined;
  if (edge && snippet) {
    edge.context_snippet = snippet.slice(0, 300);
    edge.context_class = classifyContext(snippet);
    edge.context_source_tier = 'B';
    edge.context_source_uri = `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}/citations`;
  }
};
