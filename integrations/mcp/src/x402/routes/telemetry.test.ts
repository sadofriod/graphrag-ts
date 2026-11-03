import { describe, expect, test } from 'bun:test';
import type { PaidRouteDeps } from '../routeTypes.ts';
import { usdcFromAtomic } from '../telemetry.ts';
import { handleTelemetry } from './telemetry.ts';

const transaction = '0xabc123';
const settlement = (network: string, amountAtomic = '20000') => ({
  network,
  amountAtomic,
  transaction,
  settledAt: '2026-11-02T02:31:55.000Z',
});

const createDeps = (options: {
  readonly settlements?: readonly { network: string; settled: number; settledAtomic: string; lastSettledAt: string | null }[];
  readonly recent?: readonly ReturnType<typeof settlement>[];
  readonly snapshot?: boolean;
  readonly fail?: boolean;
} = {}): PaidRouteDeps => {
  const telemetry = {
    settlementSummary: async () => {
      if (options.fail) throw new Error('private database failure');
      return options.settlements ?? [];
    },
    recentSettlements: async () => options.recent ?? [],
    publicCallSummary: async () => ({ calls: 13, callers: 3, p95LatencyMs: 11 }),
  };
  const integrity = {
    activeSnapshot: async () => options.snapshot === false ? undefined : ({
      id: 'ri-20261025-1526',
      built_at: '2026-10-25T15:26:00.000Z',
      manifest: { counts: { papers: 218841, cites: 247137, retractions: 1234, contexts: 0 } },
    }),
  };
  return { telemetry, integrity } as unknown as PaidRouteDeps;
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
    }));
    expect(response?.status).toBe(200);
    expect(response?.headers.get('access-control-allow-origin')).toBe('*');
    const payload = await response?.json();
    expect(payload).toMatchObject({
      corpus: { snapshot_id: 'ri-20261025-1526', papers: 218841, citation_edges: 247137, retractions: 1234 },
      payments: {
        mainnet: { settlements: 4, volume_usdc: '0.08', networks: ['eip155:42161'] },
        recent_mainnet: [{ explorer_url: `https://arbiscan.io/tx/${transaction}` }],
      },
      public_calls: { window_days: 30, calls: 13, callers: 3, p95_latency_ms: 11 },
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
