import type { AppConfig } from '../config.ts';
import { httpError } from '../dashboard.ts';
import type { IndexStore } from '../store.ts';
import { wellKnownResponse } from '../well-known.ts';
import type { createPaidQueryRoute } from '../x402/gateway.ts';
import { handleOpenApi } from '../x402/routes/openapi.ts';

const healthResponse = async (request: Request, store: IndexStore): Promise<Response | undefined> => {
  if (new URL(request.url).pathname !== '/healthz' || request.method !== 'GET') {
    return undefined;
  }
  try {
    await store.ping();
    return new Response(JSON.stringify({ status: 'ready' }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch {
    return httpError(503, 'Database unavailable.');
  }
};

const isPaidHostname = (request: Request, paidHostname: string): boolean => {
  const expected = paidHostname.toLowerCase();
  if (new URL(request.url).hostname.toLowerCase() === expected) return true;
  const host = request.headers.get('host');
  if (!host) return false;
  try {
    return new URL(`http://${host}`).hostname.toLowerCase() === expected;
  } catch {
    return false;
  }
};

export const publicRouteResponse = async (
  request: Request,
  store: IndexStore,
  paidRoute?: ReturnType<typeof createPaidQueryRoute>,
  paidHostname?: string,
  publicBaseUrl?: string,
): Promise<Response | undefined> => {
  if (paidHostname && isPaidHostname(request, paidHostname)) {
    const path = new URL(request.url).pathname;
    if (!path.startsWith('/api/v1/') && path !== '/.well-known/x402') {
      return httpError(404, 'Not found.');
    }
  }
  const health = await healthResponse(request, store);
  if (health) return health;
  const openApi = handleOpenApi(request);
  if (openApi) return openApi;
  const paidResponse = paidRoute ? await paidRoute(request) : undefined;
  if (paidResponse) return paidResponse;
  return wellKnownResponse(request, publicBaseUrl ? { publicBaseUrl } : undefined);
};

export const isAnonymousDashboardRequest = (request: Request, publicEnabled: boolean): boolean => {
  const pathname = new URL(request.url).pathname;
  const isDashboardRoute = pathname === '/api/usage' || pathname === '/api/workspaces'
    || pathname.startsWith('/api/workspaces/');
  return publicEnabled && isDashboardRoute && !request.headers.has('authorization');
};

export const createPublicRateLimiter = (config: AppConfig) => {
  const publicRequests = new Map<string, number[]>();
  return (ip: string): Response | undefined => {
    const now = Date.now();
    for (const [trackedIp, timestamps] of publicRequests) {
      const activeTimestamps = timestamps.filter((timestamp) => now - timestamp < 60_000);
      if (activeTimestamps.length === 0) publicRequests.delete(trackedIp);
      else if (activeTimestamps.length !== timestamps.length) publicRequests.set(trackedIp, activeTimestamps);
    }
    const recent = (publicRequests.get(ip) ?? []).filter((timestamp) => now - timestamp < 60_000);
    if (recent.length >= config.MCP_PUBLIC_RATE_PER_MIN) {
      publicRequests.set(ip, recent);
      const retryAfter = Math.max(1, Math.ceil((recent[0]! + 60_000 - now) / 1_000));
      const response = httpError(429, 'The public MCP request limit has been reached.');
      response.headers.set('retry-after', String(retryAfter));
      return response;
    }
    recent.push(now);
    publicRequests.set(ip, recent);
    return undefined;
  };
};
