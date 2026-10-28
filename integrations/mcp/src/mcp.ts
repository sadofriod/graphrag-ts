import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { AppConfig } from './config.ts';
import { createMcpServer, createQueryLimiter, type McpToolOptions } from './mcp/tools.ts';
import type { Logger } from './log.ts';
import type { IndexStore } from './store.ts';
import { authenticate, createAccessGuard, loadAccessPolicy, PUBLIC_ACCOUNT, type AccessAccount, type AccessPolicy } from './access.ts';
import { dashboardResponse, httpError } from './dashboard.ts';
import type { createPaidQueryRoute } from './x402/gateway.ts';
import { x402Settings } from './x402/settings.ts';
import { loadDatasetRegistry } from './x402/datasets.ts';
import { createFacilitatorClient } from './x402/facilitator.ts';
import { createCdpFacilitatorClient } from './x402/cdp.ts';
import { fetchSupportedKinds, findUptoFacilitatorAddress } from './x402/supported.ts';
import { createJudge } from './integrity/judge.ts';
import { wellKnownResponse } from './well-known.ts';

const paidFacilitator = (config: AppConfig, facilitatorUrl: string) => {
  const hasKeyId = Boolean(config.CDP_API_KEY_ID);
  const hasKeySecret = Boolean(config.CDP_API_KEY_SECRET);
  assertCdpCredentialsPaired(config);
  if (hasKeyId && hasKeySecret && new URL(facilitatorUrl).hostname === 'api.cdp.coinbase.com') {
    return createCdpFacilitatorClient({ apiKeyId: config.CDP_API_KEY_ID as string, apiKeySecret: config.CDP_API_KEY_SECRET as string, baseUrl: facilitatorUrl });
  }
  return createFacilitatorClient({ url: facilitatorUrl });
};

const assertCdpCredentialsPaired = (config: AppConfig): void => {
  const hasKeyId = Boolean(config.CDP_API_KEY_ID);
  const hasKeySecret = Boolean(config.CDP_API_KEY_SECRET);
  if (hasKeyId !== hasKeySecret) {
    throw new Error(`Missing required CDP setting: ${hasKeyId ? 'CDP_API_KEY_SECRET' : 'CDP_API_KEY_ID'}.`);
  }
};

const isLocalHost = (request: Request): boolean => {
  const host = request.headers.get('host');
  if (!host) return false;
  try {
    const hostname = new URL(`http://${host}`).hostname;
    return ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  } catch {
    return false;
  }
};

export type McpSession = {
  readonly server: McpServer;
  readonly transport: WebStandardStreamableHTTPServerTransport;
  lastActivityAt: number;
  activeRequests: number;
  readonly accountId: string | undefined;
  readonly tier: 'public' | 'keyed';
};

type SessionMap = Map<string, McpSession>;

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

const returnAuthError = (
  request: Request,
  policy: AccessPolicy | undefined,
  publicEnabled: boolean,
  publicBaseUrl?: string,
): { response?: Response; account?: AccessAccount; tier: 'public' | 'keyed' } => {
  if (policy && publicEnabled && new URL(request.url).pathname === '/mcp' && !request.headers.has('authorization')) {
    return { account: PUBLIC_ACCOUNT, tier: 'public' };
  }
  if (!policy && !isLocalHost(request)) {
    return { response: httpError(403, 'Only localhost clients are allowed without MCP_ACCESS_FILE.'), tier: 'keyed' };
  }
  const account = policy ? authenticate(request, policy) : undefined;
  if (policy && !account) {
    const response = httpError(401, 'A valid, unexpired bearer credential is required.');
    const origin = publicBaseUrl ? new URL(publicBaseUrl).origin : new URL(request.url).origin;
    const resourcePath = new URL(request.url).pathname === '/mcp'
      ? '/.well-known/oauth-protected-resource/mcp'
      : '/.well-known/oauth-protected-resource';
    response.headers.set('www-authenticate', `Bearer realm="graphrag", resource_metadata="${origin}${resourcePath}"`);
    return { response, tier: 'keyed' };
  }
  return { ...(account ? { account } : {}), tier: 'keyed' };
};

const withTierHeader = (response: Response, tier: 'public' | 'keyed'): Response => {
  const headers = new Headers(response.headers);
  headers.set('x-ashesborn-tier', tier);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};

const clientIp = (request: Request, requestIp?: (request: Request) => string | undefined): string => {
  const cloudflare = request.headers.get('cf-connecting-ip')?.trim();
  if (cloudflare) return cloudflare;
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded) return forwarded;
  return requestIp?.(request)?.trim() || 'unknown';
};

const paidRouteResponse = async (
  request: Request,
  paidRoute: ReturnType<typeof createPaidQueryRoute> | undefined,
): Promise<Response | undefined> => paidRoute ? paidRoute(request) : undefined;

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

const handleExistingSession = async (
  request: Request,
  sessionId: string,
  sessions: SessionMap,
  logger: Logger,
  account?: AccessAccount,
  tier: 'public' | 'keyed' = 'keyed',
): Promise<Response> => {
  const session = sessions.get(sessionId);
  if (!session || session.accountId !== account?.id || session.tier !== tier) {
    return httpError(404, 'MCP session not found.');
  }
  session.lastActivityAt = Date.now();
  session.activeRequests += 1;
  try {
    const response = await session.transport.handleRequest(request);
    if (request.method === 'DELETE') {
      sessions.delete(sessionId);
      await session.server.close();
    }
    return response;
  } catch (error) {
    logger.error('MCP request failed.', {
      error_name: error instanceof Error ? error.name : 'UnknownError',
      error_message: error instanceof Error ? error.message : 'Unknown request error.',
    });
    return httpError(400, 'Invalid MCP request.');
  } finally {
    session.activeRequests -= 1;
    session.lastActivityAt = Date.now();
  }
};

const closeIdleSessions = async (
  sessions: SessionMap,
  idleTimeoutMs: number,
  logger: Logger,
): Promise<void> => {
  const now = Date.now();
  const expired = [...sessions.entries()].filter(([, session]) =>
    session.activeRequests === 0 && now - session.lastActivityAt >= (session.tier === 'public' ? 60_000 : idleTimeoutMs),
  );
  for (const [sessionId] of expired) {
    sessions.delete(sessionId);
  }
  await Promise.all(expired.map(async ([, session]) => {
    try {
      await session.server.close();
    } catch (error) {
      logger.warn('Could not close expired MCP session.', {
        error_name: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }));
};

const startSession = async (
  request: Request,
  store: IndexStore,
  config: AppConfig,
  logger: Logger,
  sessions: SessionMap,
  queryLimiter: ReturnType<typeof createQueryLimiter>,
  mcpTools: McpToolOptions,
  account?: AccessAccount,
  tier: 'public' | 'keyed' = 'keyed',
): Promise<Response> => {
  if (request.method !== 'POST') {
    return httpError(400, 'Initialize an MCP session before sending requests.');
  }

  const server = createMcpServer(store, config, logger, queryLimiter, account ? createAccessGuard(account, store) : undefined, mcpTools);
  let newSessionId: string | undefined;
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: randomUUID,
    maxRequestBodySize: 1_000_000,
  });
  transport.onerror = (error) => logger.error('MCP transport error.', { error_name: error.name });
  transport.onclose = () => {
    if (newSessionId) {
      sessions.delete(newSessionId);
    }
  };
  try {
    await server.connect(transport as unknown as Parameters<McpServer['connect']>[0]);
    const response = await transport.handleRequest(request);
    newSessionId = transport.sessionId;
    if (newSessionId) {
      sessions.set(newSessionId, { server, transport, lastActivityAt: Date.now(), activeRequests: 0, accountId: account?.id, tier });
    } else {
      await server.close();
    }
    return response;
  } catch (error) {
    logger.error('MCP request failed.', {
      error_name: error instanceof Error ? error.name : 'UnknownError',
      error_message: error instanceof Error ? error.message : 'Unknown request error.',
    });
    await server.close();
    return httpError(400, 'Invalid MCP request.');
  }
};

export const createHttpHandler = (
  store: IndexStore,
  config: AppConfig,
  logger: Logger,
  sessions: SessionMap = new Map(),
  queryLimiter = createQueryLimiter(config.MAX_ACTIVE_QUERIES),
  policy?: AccessPolicy,
  paidRoute?: ReturnType<typeof createPaidQueryRoute>,
  paidHostname?: string,
  mcpTools: McpToolOptions = {},
  requestIp?: (request: Request) => string | undefined,
  publicBaseUrl?: string,
) => {
  let pendingSessions = 0;
  let pendingPublicSessions = 0;
  const publicRequests = new Map<string, number[]>();
  return async (request: Request, runtimeRequestIp?: (request: Request) => string | undefined): Promise<Response> => {
    if (paidHostname && isPaidHostname(request, paidHostname)) {
      const path = new URL(request.url).pathname;
      if (!path.startsWith('/api/v1/') && path !== '/.well-known/x402') {
        return httpError(404, 'Not found.');
      }
    }
    const health = await healthResponse(request, store);
    if (health) {
      return health;
    }
    const paidResponse = await paidRouteResponse(request, paidRoute);
    if (paidResponse) return paidResponse;
    const discovery = wellKnownResponse(request, publicBaseUrl ? { publicBaseUrl } : undefined);
    if (discovery) return discovery;
    const pathname = new URL(request.url).pathname;
    const isMcpRoute = pathname === '/mcp';
    const isDashboardRoute = pathname === '/api/usage' || pathname === '/api/workspaces'
      || pathname.startsWith('/api/workspaces/');
    if (policy && config.MCP_PUBLIC_TIER && isDashboardRoute && !request.headers.has('authorization')) {
      return httpError(404, 'Not found.');
    }
    const auth = returnAuthError(request, policy, config.MCP_PUBLIC_TIER, publicBaseUrl);
    if (auth.response) return auth.response;
    const account = auth.account;
    const dashboard = auth.tier === 'public' ? undefined : await dashboardResponse(request, store, account);
    if (dashboard) {
      return dashboard;
    }
    if (!isMcpRoute) {
      return httpError(404, 'Not found.');
    }
    await closeIdleSessions(sessions, config.HTTP_SESSION_IDLE_TIMEOUT_MS, logger);
    const tier = auth.tier;
    if (tier === 'public') {
      const ip = clientIp(request, runtimeRequestIp ?? requestIp);
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
        return withTierHeader(response, tier);
      }
      recent.push(now);
      publicRequests.set(ip, recent);
    }
    const sessionId = request.headers.get('mcp-session-id');
    if (sessionId) {
      return withTierHeader(await handleExistingSession(request, sessionId, sessions, logger, account, tier), tier);
    }
    const publicSessionCount = [...sessions.values()].filter((session) => session.tier === 'public').length;
    const keyedSessionCount = sessions.size - publicSessionCount;
    if (tier === 'public' && publicSessionCount + pendingPublicSessions >= config.MCP_PUBLIC_MAX_SESSIONS) {
      return withTierHeader(httpError(503, 'The server has reached its public MCP session limit.'), tier);
    }
    if (tier === 'keyed' && keyedSessionCount + pendingSessions >= config.MAX_HTTP_SESSIONS) {
      return withTierHeader(httpError(503, 'The server has reached its MCP session limit.'), tier);
    }
    if (tier === 'public') pendingPublicSessions += 1;
    else pendingSessions += 1;
    try {
       return withTierHeader(await startSession(request, store, config, logger, sessions, queryLimiter,
         { ...mcpTools, tier }, account, tier), tier);
    } finally {
      if (tier === 'public') pendingPublicSessions -= 1;
      else pendingSessions -= 1;
    }
  };
};

const createPaidRoute = async (store: IndexStore, config: AppConfig, logger: Logger, limiter: ReturnType<typeof createQueryLimiter>, judge: ReturnType<typeof createJudge>) => {
  const settings = x402Settings(config);
  if (!settings) return { settings, route: undefined };
  const registry = await loadDatasetRegistry(config.X402_DATASETS_FILE as string);
  const facilitator = paidFacilitator(config, settings.facilitatorUrl);
  const graphDatasets = registry.datasets.filter((dataset) => dataset.product === 'graph');
  const usesUpto = graphDatasets.some((dataset) => dataset.pricing.global.scheme === 'upto');
  const uptoFacilitatorAddress = usesUpto
    ? findUptoFacilitatorAddress((await fetchSupportedKinds({ facilitatorUrl: settings.facilitatorUrl, facilitator })).kinds, settings.network)
    : undefined;
  if (usesUpto && !uptoFacilitatorAddress) {
    throw new Error(`X402 upto pricing requires a facilitator that advertises extra.facilitatorAddress for ${settings.network}; switch the dataset to pricing.global.scheme "exact" or use a facilitator that supports upto.`);
  }
  const route = (await import('./x402/gateway.ts')).createPaidQueryRoute({
    store, config, logger, registry, payments: store.paymentStore, integrity: store.integrityStore, judge,
    facilitator, limiter, settings: { ...settings, ...(uptoFacilitatorAddress ? { uptoFacilitatorAddress } : {}) },
  });
  return { settings, route };
};

export const startMcpServer = async (
  store: IndexStore,
  config: AppConfig,
  logger: Logger,
): Promise<() => Promise<void>> => {
  assertCdpCredentialsPaired(config);
  const queryLimiter = createQueryLimiter(config.MAX_ACTIVE_QUERIES);
  const judge = createJudge(store.integrityStore);
  const mcpTools: McpToolOptions = { integrity: { store: store.integrityStore, judge } };
  if (config.MCP_ACCESS_FILE && config.MCP_TRANSPORT === 'stdio') {
    throw new Error('MCP_ACCESS_FILE requires HTTP transport; stdio cannot authenticate individual callers.');
  }
  const policy = config.MCP_ACCESS_FILE ? await loadAccessPolicy(config.MCP_ACCESS_FILE) : undefined;
  if (config.MCP_TRANSPORT === 'stdio') {
    const server = createMcpServer(store, config, logger, queryLimiter, undefined, mcpTools);
    await server.connect(new StdioServerTransport());
    logger.info('MCP server listening on stdio.');
    return async () => server.close();
  }

  const { settings, route: paidRoute } = await createPaidRoute(store, config, logger, queryLimiter, judge);
  const sessions: SessionMap = new Map();
  const createHandler = createHttpHandler(store, config, logger, sessions, queryLimiter, policy, paidRoute,
    settings?.publicBaseUrl ? new URL(settings.publicBaseUrl).hostname : undefined, mcpTools, undefined, config.MCP_PUBLIC_BASE_URL);
  const closeIdleSessionsHandle = setInterval(() => {
    void closeIdleSessions(sessions, config.HTTP_SESSION_IDLE_TIMEOUT_MS, logger);
  }, Math.min(config.HTTP_SESSION_IDLE_TIMEOUT_MS, 60_000));
  const httpServer = Bun.serve({
    hostname: config.MCP_HOST,
    port: config.MCP_PORT,
    idleTimeout: Math.min(255, Math.ceil(config.QUERY_TIMEOUT_MS / 1_000) + 5),
    fetch: async (request, server) => {
      try {
        return await createHandler(request, (input) => server.requestIP(input)?.address);
      } catch (error) {
        logger.error('HTTP request failed.', { error_name: error instanceof Error ? error.name : 'UnknownError' });
        return httpError(503, 'The operation is unavailable. Check the server logs.');
      }
    },
  });
  logger.info('MCP server listening on HTTP.', { host: config.MCP_HOST, port: config.MCP_PORT });

  return async () => {
    httpServer.stop(true);
    clearInterval(closeIdleSessionsHandle);
    await Promise.all([...sessions.values()].map((session) => session.server.close()));
    sessions.clear();
  };
};
