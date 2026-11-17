import { expect, test } from 'bun:test';

type RpcResponse = {
  readonly id?: number;
  readonly result?: {
    readonly serverInfo?: { readonly name?: string };
    readonly tools?: readonly {
      readonly name: string;
      readonly description?: string;
      readonly inputSchema?: unknown;
    }[];
  };
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
  const decoder = new TextDecoder();
  let buffered = '';
  const responses = new Map<number, RpcResponse>();
  const deadline = Date.now() + 30_000;

  const readResponse = async (id: number): Promise<RpcResponse> => {
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

  try {
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'catalog-test', version: '1.0.0' },
      },
    })}\n`);
    const initialized = await readResponse(1);
    expect(initialized.result?.serverInfo?.name).toBe('graphrag-mcp-server');

    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`);

    const listed = await readResponse(2);
    const tools = listed.result?.tools ?? [];
    expect(tools.length).toBeGreaterThanOrEqual(8);
    for (const name of [
      'integrity_paper_status',
      'retraction_propagation',
      'integrity_evidence_audit',
      'query_graph',
      'query_graph_global',
      'submit_index_job',
      'remember_text',
      'get_index_job',
    ]) {
      expect(tools.some((tool) => tool.name === name)).toBe(true);
    }
    for (const tool of tools) {
      expect(tool.description?.trim().length ?? 0).toBeGreaterThan(0);
      expect(typeof tool.inputSchema).toBe('object');
      expect(tool.inputSchema).not.toBeNull();
      expect(Array.isArray(tool.inputSchema)).toBe(false);
    }
  } finally {
    child.kill();
    await child.exited;
    reader.releaseLock();
  }
});
