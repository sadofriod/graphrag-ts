import { buildChallenge, requirementsFor } from './challenge.ts';
import { findDataset, isJudgmentDataset } from './datasets.ts';
import type { PaidRouteDeps } from './routeTypes.ts';
import { parseRequestBody } from './payload.ts';
import { handlePaidQuery } from './paymentFlow.ts';
import { corsHeaders, errorResponse, withServerTiming } from './http.ts';
import { handleCatalogue } from './routes/catalogue.ts';
import { handleTelemetry } from './routes/telemetry.ts';
import { handleDiscovery } from './routes/discovery.ts';
import { handleOpenApi } from './routes/openapi.ts';
import { handleLlmsTxt } from './routes/llms.ts';
import { handleLanding } from './routes/landing.ts';
import { handleIntegrityRoute } from '../integrity/routes.ts';

export type { PaidRouteDeps } from './routeTypes.ts';

export const createPaidQueryRoute = (deps: PaidRouteDeps) => async (request: Request): Promise<Response | undefined> => {
  const startedAt = performance.now();
  const response = await routeRequest(request, deps);
  return response ? withServerTiming(response, startedAt) : undefined;
};

const routeRequest = async (request: Request, deps: PaidRouteDeps): Promise<Response | undefined> => {
  const path = new URL(request.url).pathname;
  if (path.startsWith('/api/v1/') && request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: {
      ...corsHeaders,
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'PAYMENT-SIGNATURE,Content-Type,Idempotency-Key',
      'access-control-max-age': '600',
    } });
  }
  const landing = handleLanding(request);
  if (landing) return landing;
  if (path === '/paper') {
    if (request.method !== 'GET') return errorResponse(405, 'Method not allowed.');
    const url = new URL(request.url);
    url.pathname = '/api/v1/judge/paper';
    const rewritten = new Request(url, { method: request.method, headers: request.headers });
    const response = await handleIntegrityRoute(rewritten, deps);
    if (!response) return errorResponse(404, 'Not found.');
    const headers = new Headers(response.headers);
    headers.set('x-compat-route', '/paper -> /api/v1/judge/paper');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
  const openApi = handleOpenApi(request);
  if (openApi) return openApi;
  const llmsTxt = handleLlmsTxt(request);
  if (llmsTxt) return llmsTxt;
  const catalogue = handleCatalogue(request, deps.registry, deps.settings);
  if (catalogue) return catalogue;
  const telemetry = await handleTelemetry(request, deps);
  if (telemetry) return telemetry;
  const discovery = handleDiscovery(request, deps);
  if (discovery) return discovery;
  const integrity = await handleIntegrityRoute(request, deps);
  if (integrity) return integrity;
  if (path !== '/api/v1/query') return undefined;
  if (request.method !== 'POST') return errorResponse(405, 'Method not allowed.');
  const parsed = await parseRequestBody(request);
  if (parsed.input) return handlePaidQuery(request, parsed.input, deps);
  // An unpaid probe never gets a 400: registries, linters and agent clients call
  // the route without knowing the body schema, and a challenge is the only
  // signal that says "this endpoint is alive and sellable".
  if (!request.headers.get('PAYMENT-SIGNATURE')) return unauthoredChallenge(request, deps);
  return errorResponse(400, parsed.error ?? 'Invalid request body.');
};

// Fallback dataset for a challenge with no usable body: the free-tier graph
// corpus. Price, asset and network match what a well-formed request would see.
const CHALLENGE_FALLBACK_DATASET = 'web3-security';

const unauthoredChallenge = (request: Request, deps: PaidRouteDeps): Response => {
  const graphs = deps.registry.datasets.filter((dataset) => !isJudgmentDataset(dataset));
  const named = findDataset(deps.registry, CHALLENGE_FALLBACK_DATASET);
  const dataset = named && !isJudgmentDataset(named) ? named : graphs[0];
  if (!dataset || isJudgmentDataset(dataset)) return errorResponse(503, 'No graph dataset is available.');
  return buildChallenge(request, dataset, 'local', requirementsFor(dataset, 'local', deps.settings), deps.settings);
};
