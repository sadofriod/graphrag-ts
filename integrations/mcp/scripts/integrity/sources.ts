import { setTimeout as delay } from 'node:timers/promises';
import { normalizeDoi } from './classify.ts';
import { normalizeRetractionDate, type RwNotice } from './retractionwatch.ts';

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
export type RequestCounter = {
  count: number;
  maxRequests?: number;
  lastOpenAlexRateLimit?: { remainingUsd?: string; reset?: string };
  onRequest?: () => void | Promise<void>;
};
type OpenAlexResponse = { results: OpenAlexWork[]; meta?: { count?: number } };
export type OpenCitationsCiting = { doi: string | null; openalexId: string | null };

const retryWait = (attempt: number): number => Math.min(500 * (2 ** (attempt - 1)), 4000);
const isNonRetryableClientError = (error: unknown): error is Error =>
  error instanceof Error && /^HTTP 4\d\d/.test(error.message) && !error.message.includes('HTTP 429');

const hardTimeout = async <T>(request: Promise<T>): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('request timeout')), 22_000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export const fetchText = async (url: string, counter: RequestCounter): Promise<string> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    if (counter.count >= (counter.maxRequests ?? Infinity)) throw new Error('Request limit reached.');
    counter.count += 1;
    await counter.onRequest?.();
    try {
      return await fetchAttempt(url, counter);
    } catch (error) {
      lastError = error;
      if (isNonRetryableClientError(error)) throw error;
    }
    if (attempt < 4) await delay(retryWait(attempt));
  }
  throw new Error(`Request failed after 4 attempts: ${String(lastError)}`);
};

const fetchAttempt = async (url: string, counter: RequestCounter): Promise<string> => {
  const response = await hardTimeout(fetch(url, { signal: AbortSignal.timeout(20_000) }));
  if (new URL(url).hostname === 'api.openalex.org') captureRateLimit(response, counter);
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${new URL(url).origin}`);
  return hardTimeout(response.text());
};

const captureRateLimit = (response: Response, counter: RequestCounter): void => {
  const remainingUsd = response.headers.get('x-ratelimit-remaining-usd');
  const reset = response.headers.get('x-ratelimit-reset');
  counter.lastOpenAlexRateLimit = {
    ...(remainingUsd ? { remainingUsd } : {}), ...(reset ? { reset } : {}),
  };
};

export const fetchJson = async <T>(url: string, counter: RequestCounter): Promise<T> =>
  JSON.parse(await fetchText(url, counter)) as T;

const openAlexBase = 'https://api.openalex.org/works';
const openAlexUrl = (params: Record<string, string>): string => {
  const apiKey = process.env.OPENALEX_API_KEY;
  const query = new URLSearchParams({ ...params, ...(apiKey ? { api_key: apiKey } : {}) });
  return `${openAlexBase}?${query.toString()}`;
};

const openAlexEntityUrl = (path: string, params: Record<string, string>): string => {
  const query = new URLSearchParams({ ...params, ...(process.env.OPENALEX_API_KEY ? { api_key: process.env.OPENALEX_API_KEY } : {}) });
  return `https://api.openalex.org/works/${path}?${query.toString()}`;
};

export const fetchWorkByDoi = (doi: string, counter: RequestCounter): Promise<OpenAlexWork> =>
  fetchJson(openAlexEntityUrl(`doi:${doi}`, { select: 'id,doi,title,publication_year,cited_by_count,is_retracted,referenced_works,primary_location' }), counter);

export const fetchWorkById = (id: string, counter: RequestCounter): Promise<OpenAlexWork> =>
  fetchJson(openAlexEntityUrl(id, { select: 'id,doi,title,publication_year,is_retracted' }), counter);

export const fetchCitingDois = async (doi: string, counter: RequestCounter): Promise<OpenCitationsCiting[]> => {
  const rows = await fetchJson<{ citing?: string }[]>(`https://api.opencitations.net/index/v2/citations/doi:${doi}`, counter);
  const unique = new Map<string, OpenCitationsCiting>();
  for (const row of rows) {
    const parsed = parseCitingIdentity(row.citing ?? '');
    if (parsed.doi || parsed.openalexId) unique.set(parsed.doi ?? parsed.openalexId ?? '', parsed);
  }
  return [...unique.values()];
};

const parseCitingIdentity = (identity: string): OpenCitationsCiting => {
  const doi = identity.match(/(?:^|\s)doi:([^\s]+)/i)?.[1] ?? null;
  const openalex = identity.match(/(?:^|\s)openalex:(?:https?:\/\/openalex\.org\/)?(W\w+)/i)?.[1] ?? null;
  return { doi: normalizeDoi(doi), openalexId: openalex?.toUpperCase() ?? null };
};

export const openAlexEntityUri = (id: string): string => `https://openalex.org/${id.replace(/^https?:\/\/openalex\.org\//i, '')}`;

export const findRetractedWorks = (page: number, counter: RequestCounter): Promise<OpenAlexResponse> =>
  fetchJson(openAlexUrl({ filter: 'is_retracted:true', sort: 'cited_by_count:desc', 'per-page': '50', page: String(page), select: 'id,doi,title,publication_year,cited_by_count,is_retracted,referenced_works,primary_location' }), counter);

export const fetchCitingWorks = (id: string, page: number, counter: RequestCounter): Promise<OpenAlexResponse> =>
  fetchJson(openAlexUrl({ filter: `cites:${id}`, 'per-page': '200', page: String(page), select: 'id,doi,title,publication_year,cited_by_count,is_retracted,referenced_works,primary_location' }), counter);

export const resolveWorks = (ids: readonly string[], counter: RequestCounter): Promise<OpenAlexResponse> =>
  fetchJson(openAlexUrl({ filter: `openalex_id:${ids.join('|')}`, 'per-page': '200', select: 'id,doi,title,publication_year,is_retracted' }), counter);

export const fetchRetractionWatch = (email: string, counter: RequestCounter): Promise<string> =>
  fetchText(`https://api.labs.crossref.org/data/retractionwatch?${encodeURIComponent(email)}`, counter);

type CsvParser = { quoted: boolean; column: number; header: string[]; field: string; selected: Record<string, string>; rowCount: number; rowHasValue: boolean; byDoi: Map<string, RwNotice[]> };
const selectedColumns = new Set(['OriginalPaperDOI', 'RetractionDate', 'Reason', 'RetractionNature']);

const saveCsvField = (parser: CsvParser): void => {
  if (parser.field.length > 0) parser.rowHasValue = true;
  if (parser.rowCount === 0) parser.header.push(parser.field);
  else {
    const name = parser.header[parser.column];
    if (name && selectedColumns.has(name)) parser.selected[name] = parser.field;
  }
  parser.field = '';
  parser.column += 1;
};

const saveCsvRow = (parser: CsvParser): void => {
  saveCsvField(parser);
  if (parser.rowCount > 0 && !parser.rowHasValue) { resetCsvRow(parser); return; }
  if (parser.rowCount === 0) parser.header = parser.header.map((field) => field.replace(/^\uFEFF/, ''));
  else saveNotice(parser);
  parser.rowCount += 1;
  resetCsvRow(parser);
};

const resetCsvRow = (parser: CsvParser): void => {
  parser.column = 0;
  parser.selected = {};
  parser.rowHasValue = false;
};

const saveNotice = (parser: CsvParser): void => {
  const doi = normalizeDoi(parser.selected.OriginalPaperDOI);
  if (!doi) return;
  const row: RwNotice = {
    date: normalizeRetractionDate(parser.selected.RetractionDate),
    reason: parser.selected.Reason?.trim() || null,
    nature: parser.selected.RetractionNature?.trim() || null,
  };
  const existing = parser.byDoi.get(doi);
  if (existing) existing.push(row);
  else parser.byDoi.set(doi, [row]);
};

const keepFieldCharacter = (parser: CsvParser): boolean => parser.rowCount === 0 || selectedColumns.has(parser.header[parser.column] ?? '');

const consumeCsvCharacter = (csv: string, index: number, parser: CsvParser): number => {
  const char = csv[index] ?? '';
  if (char === '"' && parser.quoted && csv[index + 1] === '"') return consumeEscapedQuote(index, parser);
  if (char === '"') parser.quoted = !parser.quoted;
  else if (char === ',' && !parser.quoted) saveCsvField(parser);
  else if ((char === '\r' || char === '\n') && !parser.quoted) return consumeLineBreak(csv, index, parser);
  else {
    parser.rowHasValue = true;
    if (keepFieldCharacter(parser)) parser.field += char;
  }
  return index;
};

const consumeEscapedQuote = (index: number, parser: CsvParser): number => {
  parser.rowHasValue = true;
  if (keepFieldCharacter(parser)) parser.field += '"';
  return index + 1;
};

const consumeLineBreak = (csv: string, index: number, parser: CsvParser): number => {
  if (csv[index] === '\r' && csv[index + 1] === '\n') index += 1;
  saveCsvRow(parser);
  return index;
};

const consumeCsv = (csv: string, parser: CsvParser): void => {
  for (let index = 0; index < csv.length; index += 1) index = consumeCsvCharacter(csv, index, parser);
  if (parser.field.length || parser.column || parser.selected.OriginalPaperDOI) saveCsvRow(parser);
};

export const parseRetractionWatchCsv = (csv: string): { rowCount: number; byDoi: Map<string, RwNotice[]> } => {
  const parser: CsvParser = { quoted: false, column: 0, header: [], field: '', selected: {}, rowCount: 0, rowHasValue: false, byDoi: new Map() };
  consumeCsv(csv, parser);
  console.log(JSON.stringify({ step: 'memory', rss_mb: Number((process.memoryUsage().rss / 1_048_576).toFixed(1)) }));
  return { rowCount: Math.max(0, parser.rowCount - 1), byDoi: parser.byDoi };
};

export type CrossrefMessage = { DOI?: string; 'updated-by'?: { DOI?: string; type?: string; label?: string; source?: string; updated?: { 'date-parts'?: number[][] }; 'record-id'?: string }[] };
export const fetchCrossref = (doi: string, counter: RequestCounter): Promise<{ message?: CrossrefMessage }> =>
  fetchJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, counter);

export type SemanticCitation = { contexts?: string[]; intents?: string[]; isInfluential?: boolean; citingPaper?: { externalIds?: { DOI?: string | null } | null } };
export type SemanticPage = { data?: SemanticCitation[]; next?: number | null };
export const semanticMinInterval = (): number => {
  const configured = Number(process.env.SEMANTIC_MIN_INTERVAL_MS ?? 3000);
  return Number.isFinite(configured) && configured >= 0 ? configured : 3000;
};

export const fetchSemanticPage = async (doi: string, offset: number, counter: RequestCounter): Promise<SemanticPage> => {
  if (!counter.onRequest) {
    const pace = { at: 0 };
    counter.onRequest = async () => {
      const elapsed = Date.now() - pace.at;
      const interval = semanticMinInterval();
      if (pace.at && elapsed < interval) await delay(interval - elapsed);
      pace.at = Date.now();
    };
  }
  const params = new URLSearchParams({ fields: 'contexts,intents,isInfluential,citingPaper.externalIds', limit: '100', offset: String(offset) });
  return fetchJson<SemanticPage>(`https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}/citations?${params}`, counter);
};
