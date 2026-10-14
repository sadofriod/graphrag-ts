export type ToolResult = {
  answer?: string;
  status?: string;
  phase?: string | null;
  community_level?: string | number;
  job_id?: string;
  queue_position?: number;
  error?: { code?: string; summary?: string } | null;
  index_version?: { id: string; workspace_id: string };
  sources?: readonly { source: string; excerpt: string }[];
  selected_map_answers?: readonly { answer: string; usefulness?: number }[];
};

type RpcResponse = { result?: ToolResult; error?: { message?: string } } | null;

let sessionId: string | undefined;
let nextRequestId = 0;

const readResponse = async (response: Response): Promise<RpcResponse> => {
  const responseSessionId = response.headers.get('mcp-session-id');
  if (responseSessionId) sessionId = responseSessionId;
  if (response.status === 202) return null;
  const body = await response.text();
  if (!response.ok) throw new Error(`MCP HTTP ${response.status}: ${body.slice(0, 240)}`);
  if (response.headers.get('content-type')?.includes('text/event-stream')) {
    const data = body.split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .at(-1);
    if (!data) throw new Error('MCP returned an empty event stream.');
    return JSON.parse(data) as RpcResponse;
  }
  return JSON.parse(body) as RpcResponse;
};

const postRpc = async (method: string, params?: object, notification = false): Promise<ToolResult | null> => {
  const id = notification ? undefined : ++nextRequestId;
  const response = await fetch('/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      ...(id === undefined ? {} : { id }),
      method,
      ...(params ? { params } : {}),
    }),
  });
  const payload = await readResponse(response);
  if (payload?.error) throw new Error(payload.error.message ?? 'MCP request failed.');
  return payload?.result ?? null;
};

export const connectMcp = async (): Promise<void> => {
  if (sessionId) return;
  const initialized = await postRpc('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'graphrag-web-showcase', version: '1.0.0' },
  });
  if (!initialized) throw new Error('MCP initialization did not return a protocol version.');
  await postRpc('notifications/initialized', undefined, true);
};

export const callTool = async (name: string, args: object): Promise<ToolResult> => {
  await connectMcp();
  const result = await postRpc('tools/call', { name, arguments: args }) as (ToolResult & {
    isError?: boolean;
    content?: readonly { type: string; text?: string }[];
  }) | null;
  if (!result) throw new Error('MCP returned an empty tool result.');
  const text = result.content?.find((item) => item.type === 'text')?.text;
  if (result.isError) {
    let message = text ?? 'GraphRAG operation failed.';
    try {
      const error = JSON.parse(message).error as { code?: string; message?: string } | undefined;
      if (error) message = `${error.code ? `${error.code}: ` : ''}${error.message ?? message}`;
    } catch {
      // Keep the original tool error text when it is not JSON.
    }
    throw new Error(message);
  }
  if (!text) return result;
  try {
    return JSON.parse(text) as ToolResult;
  } catch {
    return { answer: text };
  }
};

export const checkHealth = async (): Promise<void> => {
  const response = await fetch('/healthz');
  if (!response.ok) throw new Error(`SERVICE_HEALTH_CHECK_FAILED:${response.status}`);
};