import { setTimeout as delay } from 'node:timers/promises';

export type OpenAlexWork = {
  id: string;
  doi: string | null;
  title: string | null;
  publication_year: number | null;
  cited_by_count?: number | null;
  is_retracted?: boolean | null;
  referenced_works?: string[];
  primary_location?: { source?: { display_name?: string | null } | null } | null;
};
export type RequestCounter = { count: number; maxRequests?: number; onRequest?: () => void | Promise<void> };
type OpenAlexResponse = { results: OpenAlexWork[]; meta?: { count?: number } };

const retryWait = (attempt: number): number => Math.min(500 * (2 ** (attempt - 1)), 4000);
const isNonRetryableClientError = (error: unknown): error is Error =>
  error instanceof Error && /^HTTP 4\d\d/.test(error.message) && !error.message.includes('HTTP 429');

export const fetchText = async (url: string, counter: RequestCounter): Promise<string> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    if (counter.count >= (counter.maxRequests ?? Infinity)) throw new Error('Request limit reached.');
    counter.count += 1;
    await counter.onRequest?.();
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (response.ok) return await response.text();
      if (response.status < 500 && response.status !== 429) {
        throw new Error(`HTTP ${response.status} fetching ${new URL(url).origin}`);
      }
      lastError = new Error(`HTTP ${response.status} fetching ${new URL(url).origin}`);
    } catch (error) {
      lastError = error;
      if (isNonRetryableClientError(error)) throw error;
    }
    if (attempt < 4) await delay(retryWait(attempt));
  }
  throw new Error(`Request failed after 4 attempts: ${String(lastError)}`);
};

export const fetchJson = async <T>(url: string, counter: RequestCounter): Promise<T> =>
  JSON.parse(await fetchText(url, counter)) as T;

const openAlexBase = 'https://api.openalex.org/works';
const openAlexUrl = (params: Record<string, string>): string => {
  const query = new URLSearchParams(params);
  return `${openAlexBase}?${query.toString()}`;
};

export const findRetractedWorks = (page: number, counter: RequestCounter): Promise<OpenAlexResponse> =>
  fetchJson(openAlexUrl({ filter: 'is_retracted:true', sort: 'cited_by_count:desc', 'per-page': '50', page: String(page), select: 'id,doi,title,publication_year,cited_by_count,is_retracted,referenced_works,primary_location' }), counter);

export const fetchCitingWorks = (id: string, page: number, counter: RequestCounter): Promise<OpenAlexResponse> =>
  fetchJson(openAlexUrl({ filter: `cites:${id}`, 'per-page': '200', page: String(page), select: 'id,doi,title,publication_year,cited_by_count,is_retracted,referenced_works,primary_location' }), counter);

export const resolveWorks = (ids: readonly string[], counter: RequestCounter): Promise<OpenAlexResponse> =>
  fetchJson(openAlexUrl({ filter: `openalex_id:${ids.join('|')}`, 'per-page': '200', select: 'id,doi,title,publication_year,is_retracted' }), counter);

export const fetchRetractionWatch = (email: string, counter: RequestCounter): Promise<string> =>
  fetchText(`https://api.labs.crossref.org/data/retractionwatch?${encodeURIComponent(email)}`, counter);

export type CrossrefMessage = { DOI?: string; 'updated-by'?: { DOI?: string; type?: string; label?: string; source?: string; updated?: { 'date-parts'?: number[][] }; 'record-id'?: string }[] };
export const fetchCrossref = (doi: string, counter: RequestCounter): Promise<{ message?: CrossrefMessage }> =>
  fetchJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, counter);

export type SemanticCitation = { contexts?: string[]; intents?: string[]; isInfluential?: boolean; citingPaper?: { externalIds?: { DOI?: string | null } | null } };
export type SemanticPage = { data?: SemanticCitation[]; next?: number | null };
export const fetchSemanticPage = async (doi: string, offset: number, counter: RequestCounter): Promise<SemanticPage> => {
  if (!counter.onRequest) {
    const pace = { at: 0 };
    counter.onRequest = async () => {
      const elapsed = Date.now() - pace.at;
      if (pace.at && elapsed < 1100) await delay(1100 - elapsed);
      pace.at = Date.now();
    };
  }
  const params = new URLSearchParams({ fields: 'contexts,intents,isInfluential,citingPaper.externalIds', limit: '100', offset: String(offset) });
  return fetchJson<SemanticPage>(`https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}/citations?${params}`, counter);
};
