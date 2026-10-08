import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { AppConfig } from './config.ts';
import { createMcpServer } from './mcp/tools.ts';
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
  }
};

const startSession = async (
  request: Request,
  store: IndexStore,
  config: AppConfig,
  logger: Logger,
  sessions: SessionMap,
): Promise<Response> => {
  if (request.method !== 'POST') {
    return httpError(400, 'Initialize an MCP session before sending requests.');
  }

  const server = createMcpServer(store, config, logger);
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
      sessions.set(newSessionId, { server, transport });
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
) => async (request: Request): Promise<Response> => {
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
  const sessionId = request.headers.get('mcp-session-id');
  return sessionId
    ? handleExistingSession(request, sessionId, sessions, logger)
    : startSession(request, store, config, logger, sessions);
};

export const startMcpServer = async (
  store: IndexStore,
  config: AppConfig,
  logger: Logger,
): Promise<() => Promise<void>> => {
  if (config.MCP_TRANSPORT === 'stdio') {
    const server = createMcpServer(store, config, logger);
    await server.connect(new StdioServerTransport());
    logger.info('MCP server listening on stdio.');
    return async () => server.close();
  }

  const sessions: SessionMap = new Map();
  const httpServer = Bun.serve({
    hostname: config.MCP_HOST,
    port: config.MCP_PORT,
    fetch: createHttpHandler(store, config, logger, sessions),
  });
  logger.info('MCP server listening on HTTP.', { host: config.MCP_HOST, port: config.MCP_PORT });

  return async () => {
    httpServer.stop(true);
    await Promise.all([...sessions.values()].map((session) => session.server.close()));
    sessions.clear();
  };
};