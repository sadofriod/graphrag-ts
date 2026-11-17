import { expect, test } from 'bun:test';

type CatalogTool = {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: { readonly properties?: Readonly<Record<string, { readonly description?: string }>> };
  readonly annotations?: { readonly readOnlyHint?: unknown };
};

type RpcResponse = {
  readonly id?: number;
  readonly result?: {
    readonly serverInfo?: { readonly name?: string };
    readonly tools?: readonly CatalogTool[];
  };
};

const createResponseReader = (reader: ReadableStreamDefaultReader<Uint8Array>) => {
  const decoder = new TextDecoder();
  let buffered = '';
  const responses = new Map<number, RpcResponse>();
  const deadline = Date.now() + 30_000;

  return async (id: number): Promise<RpcResponse> => {
    while (!responses.has(id)) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('Timed out waiting for MCP response.');
      const result = await Promise.race([
        reader.read(),
        Bun.sleep(remaining).then(() => { throw new Error('Timed out waiting for MCP response.'); }),
      ]);
      if (result.done) throw new Error('Catalog MCP process exited before responding.');
      buffered += decoder.decode(result.value, { stream: true });
      const lines = buffered.split('\n');
      buffered = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const message = JSON.parse(line) as RpcResponse;
        if (typeof message.id === 'number') responses.set(message.id, message);
      }
    }
    const response = responses.get(id);
    if (!response) throw new Error(`Missing MCP response ${id}.`);
    return response;
  };
};

const initializeAndListTools = async (
  stdin: Bun.FileSink,
  readResponse: (id: number) => Promise<RpcResponse>,
): Promise<readonly CatalogTool[]> => {
  stdin.write(`${JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'catalog-test', version: '1.0.0' },
    },
  })}\n`);
  const initialized = await readResponse(1);
  expect(initialized.result?.serverInfo?.name).toBe('graphrag-mcp-server');

  stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`);
  return (await readResponse(2)).result?.tools ?? [];
};

const catalogToolNames = [
  'integrity_paper_status',
  'retraction_propagation',
  'integrity_evidence_audit',
  'query_graph',
  'query_graph_global',
  'submit_index_job',
  'remember_text',
  'get_index_job',
];

const integrityToolNames = ['integrity_paper_status', 'retraction_propagation', 'integrity_evidence_audit'];

const assertCatalogToolNames = (tools: readonly CatalogTool[]): void => {
  expect(tools.length).toBeGreaterThanOrEqual(8);
  for (const name of catalogToolNames) {
    expect(tools.some((tool) => tool.name === name)).toBe(true);
  }
};

const assertCatalogToolMetadata = (tools: readonly CatalogTool[]): void => {
  for (const tool of tools) {
    expect(tool.description?.trim().length ?? 0).toBeGreaterThanOrEqual(300);
    expect(typeof tool.inputSchema).toBe('object');
    expect(tool.inputSchema).not.toBeNull();
    expect(typeof tool.annotations?.readOnlyHint).toBe('boolean');
  }
};

const assertNonEmptyPropertyDescription = (tool: CatalogTool | undefined, property: 'doi' | 'paper_id'): void => {
  expect(tool?.inputSchema?.properties?.[property]?.description?.trim().length ?? 0).toBeGreaterThan(0);
};

const assertIntegrityToolProperties = (tools: readonly CatalogTool[]): void => {
  for (const name of integrityToolNames) {
    const tool = tools.find((candidate) => candidate.name === name);
    assertNonEmptyPropertyDescription(tool, 'doi');
    assertNonEmptyPropertyDescription(tool, 'paper_id');
  }
};

const assertCatalogTools = (tools: readonly CatalogTool[]): void => {
  assertCatalogToolNames(tools);
  assertCatalogToolMetadata(tools);
  assertIntegrityToolProperties(tools);
};

test('catalog stdio entrypoint exposes tool metadata without database or model configuration', async () => {
  const child = Bun.spawn(['bun', 'src/stdio-catalog.ts'], {
    cwd: import.meta.dir.replace(/\/src$/, ''),
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const reader = child.stdout.getReader();
  const stdin = child.stdin;
  if (!stdin || typeof stdin === 'number') throw new Error('Catalog MCP process has no piped stdin.');
  const readResponse = createResponseReader(reader);
  try {
    const tools = await initializeAndListTools(stdin, readResponse);
    assertCatalogTools(tools);
  } finally {
    child.kill();
    await child.exited;
    reader.releaseLock();
  }
});
