import { describe, expect, it } from 'bun:test';

import { loadIgraph } from './igraphLoader';

describe('loadIgraph', () => {
  it('resolves to the WasmGraph class and can build a graph', async () => {
    const WasmGraph = await loadIgraph();

    expect(typeof WasmGraph.fromEdges).toBe('function');

    const graph = WasmGraph.fromEdges(new Uint32Array([0, 1]), false);
    expect(graph.vcount()).toBe(2);
    expect(graph.ecount()).toBe(1);
    graph.free();
  });

  it('caches the load promise so the wasm is initialized only once', async () => {
    const first = loadIgraph();
    const second = loadIgraph();

    expect(first).toBe(second);

    await first;
    expect(loadIgraph()).toBe(first);
  });
});
