import type { DatasetRegistry } from '../datasets.ts';
import type { DatasetPayerSettlementRow, DatasetSettlementRow, GraphCorpusRow, NetworkPayerSettlementRow, SettlementRow, ToolCallRow } from '../telemetry.ts';
import { usdcFromAtomic } from '../telemetry.ts';

const MAINNET_NETWORKS = new Set(['eip155:8453', 'eip155:42161']);
const TESTNET_NETWORKS = new Set(['eip155:84532', 'eip155:421614']);

const sumGroup = (rows: readonly DatasetSettlementRow[]) => ({
  settlements: rows.reduce((total, row) => total + row.settled, 0),
  volume_usdc: usdcFromAtomic(rows.reduce((total, row) => total + BigInt(row.settledAtomic), 0n).toString()),
});

const payerStats = (rows: readonly (NetworkPayerSettlementRow | DatasetPayerSettlementRow)[], operatorPayers: ReadonlySet<string>) => {
  const knownPayers = rows.filter((row): row is typeof row & { payer: string } => row.payer !== null && row.settled > 0);
  const operators = knownPayers.filter((row) => row.payer !== null && operatorPayers.has(row.payer));
  const external = knownPayers.filter((row) => row.payer !== null && !operatorPayers.has(row.payer));
  return {
    payers: new Set(knownPayers.map((row) => row.payer)).size,
    operator_settlements: operators.reduce((total, row) => total + row.settled, 0),
    external_settlements: external.reduce((total, row) => total + row.settled, 0),
    external_volume_usdc: usdcFromAtomic(external.reduce((total, row) => total + BigInt(row.settledAtomic), 0n).toString()),
    external_payers: new Set(external.map((row) => row.payer)).size,
  };
};

export const attributedSettlementGroup = (
  rows: readonly SettlementRow[], payerRows: readonly NetworkPayerSettlementRow[], networks: ReadonlySet<string>,
  operatorPayers: ReadonlySet<string>,
) => {
  const selected = rows.filter((row) => networks.has(row.network));
  const payers = payerRows.filter((row) => networks.has(row.network));
  return {
    settlements: selected.reduce((total, row) => total + row.settled, 0),
    volume_usdc: usdcFromAtomic(selected.reduce((total, row) => total + BigInt(row.settledAtomic), 0n).toString()),
    networks: [...new Set(selected.map((row) => row.network))].sort(),
    ...payerStats(payers, operatorPayers),
  };
};

const breakdownRow = (datasetId: string, datasetRows: readonly DatasetSettlementRow[], registry: DatasetRegistry) => {
  const mainnetRows = datasetRows.filter((row) => MAINNET_NETWORKS.has(row.network));
  const testnetRows = datasetRows.filter((row) => TESTNET_NETWORKS.has(row.network));
  const dataset = registry.datasets.find((item) => item.id === datasetId);
  const product = dataset === undefined ? 'unknown' : dataset.product === 'graph' ? 'graph'
    : dataset.tool === 'dependency_scan' ? 'advisory' : 'judgment';
  const price = dataset === undefined ? null : dataset.product === 'graph'
    ? dataset.pricing.local.usd : dataset.pricing.per_call.usd;
  const lastSettledAt = datasetRows.map((row) => row.lastSettledAt)
    .filter((value): value is string => value !== null).sort().at(-1) ?? null;
  return {
    dataset_id: datasetId, product, title: dataset?.title ?? datasetId, price_usd: price,
    mainnet: sumGroup(mainnetRows), testnet: sumGroup(testnetRows), last_settled_at: lastSettledAt,
    mainnetAtomic: mainnetRows.reduce((total, row) => total + BigInt(row.settledAtomic), 0n),
  };
};

export const datasetBreakdown = (
  rows: readonly DatasetSettlementRow[], payerRows: readonly DatasetPayerSettlementRow[],
  registry: DatasetRegistry, operatorPayers: ReadonlySet<string>,
) => {
  const grouped = new Map<string, DatasetSettlementRow[]>();
  for (const row of rows) {
    const datasetRows = grouped.get(row.datasetId) ?? [];
    datasetRows.push(row);
    grouped.set(row.datasetId, datasetRows);
  }
  for (const dataset of registry.datasets) {
    if (!grouped.has(dataset.id)) grouped.set(dataset.id, []);
  }
  return [...grouped.entries()].map(([datasetId, datasetRows]) => {
    const breakdown = breakdownRow(datasetId, datasetRows, registry);
    const attributed = payerRows.filter((row) => row.datasetId === datasetId);
    const mainnet = { ...breakdown.mainnet, ...payerStats(attributed.filter((row) => MAINNET_NETWORKS.has(row.network)), operatorPayers) };
    const testnet = { ...breakdown.testnet, ...payerStats(attributed.filter((row) => TESTNET_NETWORKS.has(row.network)), operatorPayers) };
    return { ...breakdown, mainnet, testnet };
  })
    .sort((left, right) => left.mainnetAtomic === right.mainnetAtomic
      ? left.dataset_id.localeCompare(right.dataset_id)
      : left.mainnetAtomic > right.mainnetAtomic ? -1 : 1)
    .map((row) => ({
      dataset_id: row.dataset_id, product: row.product, title: row.title, price_usd: row.price_usd,
      mainnet: row.mainnet, testnet: row.testnet, last_settled_at: row.last_settled_at,
    }));
};

export const graphCorpus = (rows: readonly GraphCorpusRow[]) => rows.length === 0 ? null : ({
  entities: rows.reduce((total, row) => total + row.entities, 0),
  relationships: rows.reduce((total, row) => total + row.relationships, 0),
  workspaces: rows.map((row) => ({
    workspace_id: row.workspaceId,
    entities: row.entities,
    relationships: row.relationships,
    published_at: row.publishedAt,
  })),
});

export const toolBreakdown = (rows: readonly ToolCallRow[]) => [...rows]
  .sort((left, right) => right.calls - left.calls || left.tool.localeCompare(right.tool))
  .map((row) => ({ tool: row.tool, calls: row.calls }));

export const datasetTitle = (registry: DatasetRegistry, datasetId: string): string =>
  registry.datasets.find((dataset) => dataset.id === datasetId)?.title ?? datasetId;
