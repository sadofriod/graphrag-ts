import type { PaidRouteDeps } from './routeTypes.ts';
import { parseRequestBody } from './payload.ts';
import { handlePaidQuery } from './paymentFlow.ts';
import { corsHeaders, errorResponse, withServerTiming } from './http.ts';
import { handleCatalogue } from './routes/catalogue.ts';
import { handleDiscovery } from './routes/discovery.ts';

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
  const catalogue = handleCatalogue(request, deps.registry);
  if (catalogue) return catalogue;
  const discovery = handleDiscovery(request, deps);
  if (discovery) return discovery;
  if (path !== '/api/v1/query') return undefined;
  if (request.method !== 'POST') return errorResponse(405, 'Method not allowed.');
  const parsed = await parseRequestBody(request);
  return parsed.input ? handlePaidQuery(request, parsed.input, deps) : errorResponse(400, parsed.error ?? 'Invalid request body.');
};
