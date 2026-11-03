import type { PaidRouteDeps } from '../routeTypes.ts';
import { errorResponse, jsonResponse } from '../http.ts';
import { usdcFromAtomic } from '../telemetry.ts';

const MAINNET_NETWORKS = new Set(['eip155:8453', 'eip155:42161']);
const TESTNET_NETWORKS = new Set(['eip155:84532', 'eip155:421614']);
const EXPLORERS: Readonly<Record<string, string>> = {
  'eip155:8453': 'https://basescan.org/tx/',
  'eip155:42161': 'https://arbiscan.io/tx/',
};

const settlementGroup = (rows: Awaited<ReturnType<PaidRouteDeps['telemetry']['settlementSummary']>>, networks: ReadonlySet<string>) => {
  const selected = rows.filter((row) => networks.has(row.network));
  return {
    settlements: selected.reduce((total, row) => total + row.settled, 0),
    volume_usdc: usdcFromAtomic(selected.reduce((total, row) => total + BigInt(row.settledAtomic), 0n).toString()),
    networks: [...new Set(selected.map((row) => row.network))].sort(),
  };
};

const buildPayload = async (deps: PaidRouteDeps) => {
  const [settlements, recentSettlements, publicCalls, snapshot] = await Promise.all([
    deps.telemetry.settlementSummary(),
    deps.telemetry.recentSettlements(100),
    deps.telemetry.publicCallSummary(30),
    deps.integrity.activeSnapshot(),
  ]);
  const recentMainnet = recentSettlements
    .filter((row) => MAINNET_NETWORKS.has(row.network) && EXPLORERS[row.network] !== undefined)
    .slice(0, 5)
    .map((row) => ({
      network: row.network,
      amount_usdc: usdcFromAtomic(row.amountAtomic),
      transaction: row.transaction,
      settled_at: row.settledAt,
      explorer_url: `${EXPLORERS[row.network]}${row.transaction}`,
    }));
  const unclassified = settlements
    .filter((row) => !MAINNET_NETWORKS.has(row.network) && !TESTNET_NETWORKS.has(row.network))
    .map((row) => ({ network: row.network, settlements: row.settled }))
    .sort((left, right) => left.network.localeCompare(right.network));

  return {
    generated_at: new Date().toISOString(),
    corpus: snapshot ? {
      snapshot_id: snapshot.id,
      built_at: snapshot.built_at instanceof Date ? snapshot.built_at.toISOString() : new Date(snapshot.built_at).toISOString(),
      papers: snapshot.manifest.counts.papers,
      citation_edges: snapshot.manifest.counts.cites,
      retractions: snapshot.manifest.counts.retractions,
    } : null,
    payments: {
      mainnet: settlementGroup(settlements, MAINNET_NETWORKS),
      testnet: settlementGroup(settlements, TESTNET_NETWORKS),
      unclassified,
      recent_mainnet: recentMainnet,
    },
    public_calls: {
      window_days: 30,
      calls: publicCalls.calls,
      callers: publicCalls.callers,
      p95_latency_ms: publicCalls.p95LatencyMs,
    },
    verify: {
      datasets: 'https://pay.ashesborn.cloud/api/v1/datasets',
      openapi: 'https://pay.ashesborn.cloud/api/v1/openapi.json',
      note: 'Aggregate counters from the production Postgres behind this API. No caller identity is stored; public-tier callers are counted as daily pseudonyms.',
    },
  };
};

export const handleTelemetry = async (request: Request, deps: PaidRouteDeps): Promise<Response | undefined> => {
  if (new URL(request.url).pathname !== '/api/v1/telemetry') return undefined;
  if (request.method !== 'GET') return errorResponse(405, 'Method not allowed.');
  try {
    return jsonResponse(200, await buildPayload(deps), { 'cache-control': 'public, max-age=60' });
  } catch {
    return errorResponse(503, 'TELEMETRY_UNAVAILABLE');
  }
};
