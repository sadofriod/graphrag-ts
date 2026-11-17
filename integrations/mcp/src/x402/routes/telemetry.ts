import type { PaidRouteDeps } from '../routeTypes.ts';
import { errorResponse, jsonResponse } from '../http.ts';
import { usdcFromAtomic } from '../telemetry.ts';
import { attributedSettlementGroup, datasetBreakdown, datasetTitle, graphCorpus, toolBreakdown } from './telemetrySections.ts';

const MAINNET_NETWORKS = new Set(['eip155:8453', 'eip155:42161']);
const TESTNET_NETWORKS = new Set(['eip155:84532', 'eip155:421614']);
const EXPLORERS: Readonly<Record<string, string>> = {
  'eip155:8453': 'https://basescan.org/tx/',
  'eip155:42161': 'https://arbiscan.io/tx/',
};

const rejectedCount = (result: PromiseSettledResult<number>): number => result.status === 'fulfilled' ? result.value : 0;

const isOperator = (payer: string | null, operators: ReadonlySet<string>): boolean => payer !== null && operators.has(payer.toLowerCase());

const attributionResults = (results: readonly [PromiseSettledResult<Awaited<ReturnType<PaidRouteDeps['telemetry']['settlementByNetworkPayer']>>>, PromiseSettledResult<Awaited<ReturnType<PaidRouteDeps['telemetry']['settlementByDatasetPayer']>>>]) => {
  const [networkResult, datasetResult] = results;
  const available = networkResult.status === 'fulfilled' && datasetResult.status === 'fulfilled';
  return {
    available,
    network: available ? networkResult.value : [],
    dataset: available ? datasetResult.value : [],
  };
};

const queryTelemetry = async (deps: PaidRouteDeps) => {
  const [settlementsResult, recentResult, publicCallsResult, snapshotResult, datasetResult, toolsResult, rejectedResult, graphResult, networkPayersResult, datasetPayersResult] = await Promise.allSettled([
    deps.telemetry.settlementSummary(),
    deps.telemetry.recentSettlements(100),
    deps.telemetry.publicCallSummary(30),
    deps.integrity.activeSnapshot(),
    deps.telemetry.settlementByDataset(),
    deps.telemetry.publicCallsByTool(30),
    deps.telemetry.rejectedAttempts(30),
    deps.telemetry.activeGraphCorpus(),
    deps.telemetry.settlementByNetworkPayer(),
    deps.telemetry.settlementByDatasetPayer(),
  ]);
  if (settlementsResult.status === 'rejected' || recentResult.status === 'rejected') throw new Error('Required telemetry query failed.');
  return {
    settlements: settlementsResult.value, recentSettlements: recentResult.value,
    publicCalls: publicCallsResult.status === 'fulfilled' ? publicCallsResult.value : { calls: 0, callers: 0, p95LatencyMs: 0 },
    snapshot: snapshotResult.status === 'fulfilled' ? snapshotResult.value : undefined,
    datasets: datasetResult.status === 'fulfilled' ? datasetResult.value : [],
    tools: toolsResult.status === 'fulfilled' ? toolsResult.value : [],
    rejected: rejectedCount(rejectedResult),
    graph: graphResult.status === 'fulfilled' ? graphResult.value : [],
    attribution: attributionResults([networkPayersResult, datasetPayersResult]),
  };
};

const recentMainnet = (deps: PaidRouteDeps, rows: Awaited<ReturnType<PaidRouteDeps['telemetry']['recentSettlements']>>, operators: ReadonlySet<string>) => rows
    .filter((row) => MAINNET_NETWORKS.has(row.network) && EXPLORERS[row.network] !== undefined)
    .slice(0, 5)
    .map((row) => ({
      network: row.network,
      amount_usdc: usdcFromAtomic(row.amountAtomic),
      transaction: row.transaction,
      settled_at: row.settledAt,
      explorer_url: `${EXPLORERS[row.network]}${row.transaction}`,
      dataset_id: row.datasetId,
      title: datasetTitle(deps.registry, row.datasetId),
      operator: isOperator(row.payer, operators),
    }));

const unclassifiedSettlements = (settlements: Awaited<ReturnType<PaidRouteDeps['telemetry']['settlementSummary']>>) => settlements
    .filter((row) => !MAINNET_NETWORKS.has(row.network) && !TESTNET_NETWORKS.has(row.network))
    .map((row) => ({ network: row.network, settlements: row.settled }))
    .sort((left, right) => left.network.localeCompare(right.network));

const buildPayload = async (deps: PaidRouteDeps) => {
  const data = await queryTelemetry(deps);
  const configuredOperatorPayers = new Set(deps.settings.operatorPayers);
  const operatorPayers = data.attribution.available ? configuredOperatorPayers : new Set<string>();
  return {
    generated_at: new Date().toISOString(),
    corpus: data.snapshot ? {
      snapshot_id: data.snapshot.id,
      built_at: data.snapshot.built_at instanceof Date ? data.snapshot.built_at.toISOString() : new Date(data.snapshot.built_at).toISOString(),
      papers: data.snapshot.manifest.counts.papers,
      citation_edges: data.snapshot.manifest.counts.cites,
      retractions: data.snapshot.manifest.counts.retractions,
      graph: graphCorpus(data.graph),
    } : null,
    payments: {
      operator_wallets: configuredOperatorPayers.size,
      mainnet: attributedSettlementGroup(data.settlements, data.attribution.network, MAINNET_NETWORKS, operatorPayers),
      testnet: attributedSettlementGroup(data.settlements, data.attribution.network, TESTNET_NETWORKS, operatorPayers),
      unclassified: unclassifiedSettlements(data.settlements),
      rejected: { window_days: 30, attempts: data.rejected },
      by_dataset: datasetBreakdown(data.datasets, data.attribution.dataset, deps.registry, operatorPayers),
      recent_mainnet: recentMainnet(deps, data.recentSettlements, operatorPayers),
    },
    public_calls: {
      window_days: 30,
      calls: data.publicCalls.calls,
      callers: data.publicCalls.callers,
      p95_latency_ms: data.publicCalls.p95LatencyMs,
      by_tool: toolBreakdown(data.tools),
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
