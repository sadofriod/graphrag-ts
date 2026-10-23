import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { AppConfig } from './config.ts';
import { createMcpServer, createQueryLimiter } from './mcp/tools.ts';
import type { Logger } from './log.ts';
import type { IndexStore } from './store.ts';
import { authenticate, createAccessGuard, loadAccessPolicy, type AccessAccount, type AccessPolicy } from './access.ts';
import { dashboardResponse, httpError } from './dashboard.ts';
import type { createPaidQueryRoute } from './x402/gateway.ts';
import { x402Settings } from './x402/settings.ts';
import { loadDatasetRegistry } from './x402/datasets.ts';
import { createFacilitatorClient } from './x402/facilitator.ts';
import { createCdpFacilitatorClient } from './x402/cdp.ts';

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

const returnAuthError = (request: Request, policy: AccessPolicy | undefined): { response?: Response; account?: AccessAccount } => {
  if (!policy && !isLocalHost(request)) {
    return { response: httpError(403, 'Only localhost clients are allowed without MCP_ACCESS_FILE.') };
  }
  const account = policy ? authenticate(request, policy) : undefined;
  if (policy && !account) {
    const response = httpError(401, 'A valid, unexpired bearer credential is required.');
    response.headers.set('www-authenticate', 'Bearer realm="graphrag"');
    return { response };
  }
  return { ...(account ? { account } : {}) };
};

const paidRouteResponse = async (
  request: Request,
  paidRoute: ReturnType<typeof createPaidQueryRoute> | undefined,
): Promise<Response | undefined> => paidRoute ? paidRoute(request) : undefined;

const handleExistingSession = async (
  request: Request,
  sessionId: string,
  sessions: SessionMap,
  logger: Logger,
  account?: AccessAccount,
): Promise<Response> => {
  const session = sessions.get(sessionId);
  if (!session || session.accountId !== account?.id) {
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
    session.activeRequests === 0 && now - session.lastActivityAt >= idleTimeoutMs,
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
  account?: AccessAccount,
): Promise<Response> => {
  if (request.method !== 'POST') {
    return httpError(400, 'Initialize an MCP session before sending requests.');
  }

  const server = createMcpServer(store, config, logger, queryLimiter, account ? createAccessGuard(account, store) : undefined);
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
      sessions.set(newSessionId, { server, transport, lastActivityAt: Date.now(), activeRequests: 0, accountId: account?.id });
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
) => {
  let pendingSessions = 0;
  return async (request: Request): Promise<Response> => {
    const health = await healthResponse(request, store);
    if (health) {
      return health;
    }
    const paidResponse = await paidRouteResponse(request, paidRoute);
    if (paidResponse) return paidResponse;
    const auth = returnAuthError(request, policy);
    if (auth.response) return auth.response;
    const account = auth.account;
    const dashboard = await dashboardResponse(request, store, account);
    if (dashboard) {
      return dashboard;
    }
    if (new URL(request.url).pathname !== '/mcp') {
      return httpError(404, 'Not found.');
    }
    await closeIdleSessions(sessions, config.HTTP_SESSION_IDLE_TIMEOUT_MS, logger);
    const sessionId = request.headers.get('mcp-session-id');
    if (sessionId) {
      return handleExistingSession(request, sessionId, sessions, logger, account);
    }
    if (sessions.size + pendingSessions >= config.MAX_HTTP_SESSIONS) {
      return httpError(503, 'The server has reached its MCP session limit.');
    }
    pendingSessions += 1;
    try {
      return await startSession(request, store, config, logger, sessions, queryLimiter, account);
    } finally {
      pendingSessions -= 1;
    }
  };
};

export const startMcpServer = async (
  store: IndexStore,
  config: AppConfig,
  logger: Logger,
): Promise<() => Promise<void>> => {
  assertCdpCredentialsPaired(config);
  const queryLimiter = createQueryLimiter(config.MAX_ACTIVE_QUERIES);
  if (config.MCP_ACCESS_FILE && config.MCP_TRANSPORT === 'stdio') {
    throw new Error('MCP_ACCESS_FILE requires HTTP transport; stdio cannot authenticate individual callers.');
  }
  const policy = config.MCP_ACCESS_FILE ? await loadAccessPolicy(config.MCP_ACCESS_FILE) : undefined;
  if (config.MCP_TRANSPORT === 'stdio') {
    const server = createMcpServer(store, config, logger, queryLimiter);
    await server.connect(new StdioServerTransport());
    logger.info('MCP server listening on stdio.');
    return async () => server.close();
  }

  const settings = x402Settings(config);
  const paidRoute = settings
    ? (await import('./x402/gateway.ts')).createPaidQueryRoute({
        store,
        config,
        logger,
        registry: await loadDatasetRegistry(config.X402_DATASETS_FILE as string),
        payments: store.paymentStore,
         facilitator: paidFacilitator(config, settings.facilitatorUrl),
        limiter: queryLimiter,
        settings,
      })
    : undefined;
  const sessions: SessionMap = new Map();
  const createHandler = createHttpHandler(store, config, logger, sessions, queryLimiter, policy, paidRoute);
  const closeIdleSessionsHandle = setInterval(() => {
    void closeIdleSessions(sessions, config.HTTP_SESSION_IDLE_TIMEOUT_MS, logger);
  }, Math.min(config.HTTP_SESSION_IDLE_TIMEOUT_MS, 60_000));
  const httpServer = Bun.serve({
    hostname: config.MCP_HOST,
    port: config.MCP_PORT,
    idleTimeout: Math.min(255, Math.ceil(config.QUERY_TIMEOUT_MS / 1_000) + 5),
    fetch: async (request) => {
      try {
        return await createHandler(request);
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
