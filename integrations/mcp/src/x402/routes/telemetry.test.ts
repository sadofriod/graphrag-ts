import { describe, expect, test } from 'bun:test';
import type { PaidRouteDeps } from '../routeTypes.ts';
import { usdcFromAtomic } from '../telemetry.ts';
import type { DatasetSettlementRow, GraphCorpusRow, ToolCallRow } from '../telemetry.ts';
import { handleTelemetry } from './telemetry.ts';

const transaction = '0xabc123';
const settlement = (network: string, amountAtomic = '20000') => ({
  datasetId: 'graph-one',
  network,
  amountAtomic,
  transaction,
  settledAt: '2026-11-02T02:31:55.000Z',
});

const createDeps = (options: {
  readonly settlements?: readonly { network: string; settled: number; settledAtomic: string; lastSettledAt: string | null }[];
  readonly recent?: readonly ReturnType<typeof settlement>[];
  readonly byDataset?: readonly DatasetSettlementRow[];
  readonly byTool?: readonly ToolCallRow[];
  readonly graph?: readonly GraphCorpusRow[];
  readonly snapshot?: boolean;
  readonly fail?: boolean;
  readonly failRejected?: boolean;
} = {}): PaidRouteDeps => {
  const telemetry = {
    settlementSummary: async () => {
      if (options.fail) throw new Error('private database failure');
      return options.settlements ?? [];
    },
    recentSettlements: async () => options.recent ?? [],
    publicCallSummary: async () => ({ calls: 13, callers: 3, p95LatencyMs: 11 }),
    settlementByDataset: async () => options.byDataset ?? [],
    publicCallsByTool: async () => options.byTool ?? [],
    rejectedAttempts: async () => {
      if (options.failRejected) throw new Error('new telemetry query unavailable');
      return 3;
    },
    activeGraphCorpus: async () => options.graph ?? [],
  };
  const integrity = {
    activeSnapshot: async () => options.snapshot === false ? undefined : ({
      id: 'ri-20261025-1526',
      built_at: '2026-10-25T15:26:00.000Z',
      manifest: { counts: { papers: 218841, cites: 247137, retractions: 1234, contexts: 0 } },
    }),
  };
  const registry = { datasets: [
    { product: 'graph' as const, id: 'graph-one', title: 'Graph One', workspaceId: 'workspace-one',
      description: '', synthetic: false, license: { spdx: 'CC0-1.0', url: 'https://example.test' }, tags: [],
      pricing: { local: { usd: '$0.02', atomic: '20000' }, global: { scheme: 'upto' as const,
        upto: { usd: '$0.10', atomic: '100000' }, base: { usd: '$0.02', atomic: '20000' }, perMapAnswer: { usd: '$0.01', atomic: '10000' } } } },
    { product: 'graph' as const, id: 'graph-two', title: 'Graph Two', workspaceId: 'workspace-two',
      description: '', synthetic: false, license: { spdx: 'CC0-1.0', url: 'https://example.test' }, tags: [],
      pricing: { local: { usd: '$0.05', atomic: '50000' }, global: { scheme: 'upto' as const,
        upto: { usd: '$0.20', atomic: '200000' }, base: { usd: '$0.05', atomic: '50000' }, perMapAnswer: { usd: '$0.01', atomic: '10000' } } } },
  ] };
  return { telemetry, integrity, registry } as unknown as PaidRouteDeps;
};

describe('public telemetry route', () => {
  test.each([
    ['0', '0.00'],
    ['20000', '0.02'],
    ['80000', '0.08'],
    ['1000000', '1.00'],
    ['1234567', '1.234567'],
    ['123456789012345678901234567890', '123456789012345678901234.56789'],
  ])('formats atomic USDC %s', (atomic, expected) => {
    expect(usdcFromAtomic(atomic)).toBe(expected);
  });

  test('returns the public payload with mainnet aggregates and explorer link', async () => {
    const response = await handleTelemetry(new Request('https://api.example/api/v1/telemetry'), createDeps({
      settlements: [{ network: 'eip155:42161', settled: 4, settledAtomic: '80000', lastSettledAt: '2026-11-02T02:31:55.000Z' }],
      recent: [settlement('eip155:42161')],
      graph: [{ workspaceId: 'workspace-one', entities: 2, relationships: 1, publishedAt: null }],
    }));
    expect(response?.status).toBe(200);
    expect(response?.headers.get('access-control-allow-origin')).toBe('*');
    const payload = await response?.json();
    expect(payload).toMatchObject({
      corpus: { snapshot_id: 'ri-20261025-1526', papers: 218841, citation_edges: 247137, retractions: 1234,
        graph: { entities: 2, relationships: 1, workspaces: [{ workspace_id: 'workspace-one', published_at: null }] } },
      payments: {
        mainnet: { settlements: 4, volume_usdc: '0.08', networks: ['eip155:42161'] },
        recent_mainnet: [{ explorer_url: `https://arbiscan.io/tx/${transaction}`, dataset_id: 'graph-one', title: 'Graph One' }],
        rejected: { window_days: 30, attempts: 3 },
      },
      public_calls: { window_days: 30, calls: 13, callers: 3, p95_latency_ms: 11, by_tool: [] },
      verify: {
        datasets: 'https://pay.ashesborn.cloud/api/v1/datasets',
        openapi: 'https://pay.ashesborn.cloud/api/v1/openapi.json',
        note: 'Aggregate counters from the production Postgres behind this API. No caller identity is stored; public-tier callers are counted as daily pseudonyms.',
      },
    });
  });

  test('keeps testnet and unknown networks out of classified totals and recent mainnet', async () => {
    const response = await handleTelemetry(new Request('https://api.example/api/v1/telemetry'), createDeps({
      settlements: [
        { network: 'eip155:84532', settled: 2, settledAtomic: '40000', lastSettledAt: null },
        { network: 'eip155:1', settled: 7, settledAtomic: '90000', lastSettledAt: null },
      ],
      recent: [settlement('eip155:84532'), settlement('eip155:1')],
    }));
    const payload = await response?.json();
    expect(payload.payments).toMatchObject({
      mainnet: { settlements: 0, volume_usdc: '0.00', networks: [] },
      testnet: { settlements: 2, volume_usdc: '0.04', networks: ['eip155:84532'] },
      unclassified: [{ network: 'eip155:1', settlements: 7 }],
      recent_mainnet: [],
    });
  });

  test('returns a null corpus when there is no active snapshot', async () => {
    const response = await handleTelemetry(new Request('https://api.example/api/v1/telemetry'), createDeps({ snapshot: false }));
    expect(await response?.json()).toMatchObject({ corpus: null });
  });

  test('groups settlements by registered and unknown dataset and sorts by mainnet volume', async () => {
    const response = await handleTelemetry(new Request('https://api.example/api/v1/telemetry'), createDeps({ byDataset: [
      { datasetId: 'unknown-sku', network: 'eip155:8453', settled: 2, settledAtomic: '90000', lastSettledAt: '2026-11-01T00:00:00.000Z' },
      { datasetId: 'graph-one', network: 'eip155:42161', settled: 1, settledAtomic: '20000', lastSettledAt: null },
      { datasetId: 'graph-one', network: 'eip155:84532', settled: 1, settledAtomic: '20000', lastSettledAt: null },
    ] }));
    const payload = await response?.json();
    expect(payload.payments.by_dataset).toEqual([
      { dataset_id: 'unknown-sku', product: 'unknown', title: 'unknown-sku', price_usd: null,
        mainnet: { settlements: 2, volume_usdc: '0.09' }, testnet: { settlements: 0, volume_usdc: '0.00' }, last_settled_at: '2026-11-01T00:00:00.000Z' },
      { dataset_id: 'graph-one', product: 'graph', title: 'Graph One', price_usd: '$0.02',
        mainnet: { settlements: 1, volume_usdc: '0.02' }, testnet: { settlements: 1, volume_usdc: '0.02' }, last_settled_at: null },
      { dataset_id: 'graph-two', product: 'graph', title: 'Graph Two', price_usd: '$0.05',
        mainnet: { settlements: 0, volume_usdc: '0.00' }, testnet: { settlements: 0, volume_usdc: '0.00' }, last_settled_at: null },
    ]);
  });

  test('reports null graph corpus and sorts per-tool calls', async () => {
    const response = await handleTelemetry(new Request('https://api.example/api/v1/telemetry'), createDeps({
      graph: [], byTool: [{ tool: 'z_tool', calls: 2 }, { tool: 'b_tool', calls: 4 }, { tool: 'a_tool', calls: 4 }],
    }));
    const payload = await response?.json();
    expect(payload).toMatchObject({ corpus: { graph: null }, public_calls: { by_tool: [
      { tool: 'a_tool', calls: 4 }, { tool: 'b_tool', calls: 4 }, { tool: 'z_tool', calls: 2 },
    ] } });
  });

  test('falls back to zero rejected attempts when the new query fails', async () => {
    const response = await handleTelemetry(new Request('https://api.example/api/v1/telemetry'), createDeps({ failRejected: true }));
    expect(response?.status).toBe(200);
    const payload = await response?.json();
    expect(payload.payments.rejected).toEqual({ window_days: 30, attempts: 0 });
  });

  test('rejects non-GET methods and ignores unrelated paths', async () => {
    const deps = createDeps();
    expect((await handleTelemetry(new Request('https://api.example/api/v1/telemetry', { method: 'POST' }), deps))?.status).toBe(405);
    expect(await handleTelemetry(new Request('https://api.example/other'), deps)).toBeUndefined();
  });

  test('returns a generic unavailable error without leaking store errors', async () => {
    const response = await handleTelemetry(new Request('https://api.example/api/v1/telemetry'), createDeps({ fail: true }));
    expect(response?.status).toBe(503);
    expect(await response?.json()).toEqual({ error: 'TELEMETRY_UNAVAILABLE' });
  });
});
