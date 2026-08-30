import init, { WasmGraph } from '@graphrs/igraph-wasm';

let loadPromise: Promise<typeof WasmGraph> | undefined;

const loadWasmGraph = async (): Promise<typeof WasmGraph> => {
  try {
    await init();
    return WasmGraph;
  } catch (cause) {
    throw new Error(
      'Failed to initialize @graphrs/igraph-wasm. Install it with: pnpm add @graphrs/igraph-wasm',
      { cause },
    );
  }
};

// Loads the igraph WebAssembly implementation exactly once and returns the WasmGraph class.
export const loadIgraph = (): Promise<typeof WasmGraph> => {
  loadPromise ??= loadWasmGraph();
  return loadPromise;
};
