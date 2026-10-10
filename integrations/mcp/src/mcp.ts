import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { AppConfig } from './config.ts';
import { createMcpServer, createQueryLimiter } from './mcp/tools.ts';
import type { Logger } from './log.ts';
import type { IndexStore } from './store.ts';

const httpError = (status: number, message: string): Response =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const isLocalHost = (request: Request): boolean => {
  const host = request.headers.get('host');
  if (!host) {
    return false;
  }
  try {
    const hostname = new URL(`http://${host}`).hostname;
    return ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  } catch {
    return false;
  }
};

type McpSession = {
  readonly server: McpServer;
  readonly transport: WebStandardStreamableHTTPServerTransport;
  lastActivityAt: number;
  activeRequests: number;
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

const handleExistingSession = async (
  request: Request,
  sessionId: string,
  sessions: SessionMap,
  logger: Logger,
): Promise<Response> => {
  const session = sessions.get(sessionId);
  if (!session) {
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
): Promise<Response> => {
  if (request.method !== 'POST') {
    return httpError(400, 'Initialize an MCP session before sending requests.');
  }

  const server = createMcpServer(store, config, logger, queryLimiter);
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
      sessions.set(newSessionId, { server, transport, lastActivityAt: Date.now(), activeRequests: 0 });
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

const createHttpHandler = (
  store: IndexStore,
  config: AppConfig,
  logger: Logger,
  sessions: SessionMap,
  queryLimiter: ReturnType<typeof createQueryLimiter>,
) => {
  let pendingSessions = 0;
  return async (request: Request): Promise<Response> => {
    const health = await healthResponse(request, store);
    if (health) {
      return health;
    }
    if (new URL(request.url).pathname !== '/mcp') {
      return httpError(404, 'Not found.');
    }
    if (!isLocalHost(request)) {
      return httpError(403, 'Only localhost MCP clients are allowed.');
    }

    await closeIdleSessions(sessions, config.HTTP_SESSION_IDLE_TIMEOUT_MS, logger);
    const sessionId = request.headers.get('mcp-session-id');
    if (sessionId) {
      return handleExistingSession(request, sessionId, sessions, logger);
    }
    if (sessions.size + pendingSessions >= config.MAX_HTTP_SESSIONS) {
      return httpError(503, 'The server has reached its MCP session limit.');
    }
    pendingSessions += 1;
    try {
      return await startSession(request, store, config, logger, sessions, queryLimiter);
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
  if (config.MCP_TRANSPORT === 'stdio') {
    const server = createMcpServer(store, config, logger, createQueryLimiter(config.MAX_ACTIVE_QUERIES));
    await server.connect(new StdioServerTransport());
    logger.info('MCP server listening on stdio.');
    return async () => server.close();
  }

  const sessions: SessionMap = new Map();
  const queryLimiter = createQueryLimiter(config.MAX_ACTIVE_QUERIES);
  const closeIdleSessionsHandle = setInterval(() => {
    void closeIdleSessions(sessions, config.HTTP_SESSION_IDLE_TIMEOUT_MS, logger);
  }, Math.min(config.HTTP_SESSION_IDLE_TIMEOUT_MS, 60_000));
  const httpServer = Bun.serve({
    hostname: config.MCP_HOST,
    port: config.MCP_PORT,
    fetch: createHttpHandler(store, config, logger, sessions, queryLimiter),
  });
  logger.info('MCP server listening on HTTP.', { host: config.MCP_HOST, port: config.MCP_PORT });

  return async () => {
    httpServer.stop(true);
    clearInterval(closeIdleSessionsHandle);
    await Promise.all([...sessions.values()].map((session) => session.server.close()));
    sessions.clear();
  };
};