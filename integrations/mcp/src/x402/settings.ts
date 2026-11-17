import type { AppConfig } from '../config.ts';
import { assertAsset, assertPayee } from './addresses.ts';

export type JudgeNetworkAsset = {
  readonly network: string;
  readonly asset: string;
  readonly assetName: string;
  readonly assetVersion: string;
};

export type X402Settings = {
  readonly facilitatorUrl: string;
  readonly network: string;
  readonly asset: string;
  readonly assetName: string;
  readonly assetVersion: string;
  readonly judgeNetworks: readonly JudgeNetworkAsset[];
  readonly operatorPayers: readonly string[];
  readonly payTo: string;
  readonly maxTimeoutSeconds: number;
  readonly publicBaseUrl?: string;
  readonly uptoFacilitatorAddress?: string;
};

const canonicalUsdcByNetwork: Readonly<Record<string, JudgeNetworkAsset>> = {
  'eip155:42161': {
    network: 'eip155:42161', asset: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    assetName: 'USD Coin', assetVersion: '2',
  },
};

const validateNetwork = (network: string): void => {
  if (!/^eip155:\d+$/.test(network) && !/^solana:[1-9A-HJ-NP-Za-km-z]+$/.test(network)) {
    throw new Error(`X402_NETWORK must be a CAIP-2 network in the eip155:<digits> or solana:<base58> family; got a ${network.length}-character value.`);
  }
  if (network.startsWith('solana:')) throw new Error('Solana x402 payments are not supported yet.');
};

const requiredPublicBaseUrl = (config: AppConfig): string => {
  const url = config.X402_PUBLIC_BASE_URL?.trim();
  if (!url) throw new Error('Missing required x402 setting: X402_PUBLIC_BASE_URL.');
  return url;
};

const parseOperatorPayers = (value: string | undefined): readonly string[] => [...new Set((value ?? '').split(',')
  .map((entry) => entry.trim().toLowerCase())
  .filter((entry) => /^0x[0-9a-f]{40}$/.test(entry)))];

const extraNetworkEntries = (config: AppConfig, network: string): string[] => config.X402_JUDGE_EXTRA_NETWORKS === undefined
    ? (network === 'eip155:8453' ? ['eip155:42161'] : [])
    : config.X402_JUDGE_EXTRA_NETWORKS.split(',').map((entry) => entry.trim()).filter(Boolean);

const splitNetworkEntry = (entry: string): { network: string; asset?: string } => {
  const [networkValue, assetValue, ...unexpected] = entry.split('=');
  const network = networkValue?.trim() ?? '';
  if (!network || unexpected.length > 0) throw new Error(`Invalid X402_JUDGE_EXTRA_NETWORKS entry: ${entry}.`);
  return { network, ...(assetValue === undefined ? {} : { asset: assetValue.trim() }) };
};

const networkAsset = (network: string, asset: string | undefined, canonical: JudgeNetworkAsset | undefined): JudgeNetworkAsset => {
  const selectedAsset = asset || canonical?.asset;
  if (!selectedAsset) throw new Error(`Missing asset for ${network} in X402_JUDGE_EXTRA_NETWORKS.`);
  return {
    network, asset: assertAsset(network, selectedAsset),
    assetName: canonical && !asset ? canonical.assetName : 'USDC',
    assetVersion: canonical && !asset ? canonical.assetVersion : '2',
  };
};

const parseJudgeNetworkEntry = (entry: string, seenNetworks: Set<string>): JudgeNetworkAsset | undefined => {
  const { network: candidateNetwork, asset } = splitNetworkEntry(entry);
  validateNetwork(candidateNetwork);
  if (seenNetworks.has(candidateNetwork)) return undefined;
  const canonical = canonicalUsdcByNetwork[candidateNetwork];
  seenNetworks.add(candidateNetwork);
  return networkAsset(candidateNetwork, asset, canonical);
};

const judgeNetworkAssets = (config: AppConfig, network: string, primary: JudgeNetworkAsset): JudgeNetworkAsset[] => {
  const seenNetworks = new Set([network]);
  const judgeNetworks: JudgeNetworkAsset[] = [primary];
  for (const entry of extraNetworkEntries(config, network)) {
    const parsed = parseJudgeNetworkEntry(entry, seenNetworks);
    if (parsed) judgeNetworks.push(parsed);
  }
  return judgeNetworks;
};

export const x402Settings = (config: AppConfig): X402Settings | undefined => {
  if (config.X402_ENABLED !== true) return undefined;
  const missing = [
    ['X402_FACILITATOR_URL', config.X402_FACILITATOR_URL],
    ['X402_ASSET', config.X402_ASSET],
    ['X402_PAY_TO', config.X402_PAY_TO],
    ['X402_DATASETS_FILE', config.X402_DATASETS_FILE],
  ].filter((entry) => typeof entry[1] !== 'string' || entry[1].trim().length === 0).map(([name]) => name);
  if (missing.length > 0) throw new Error(`Missing required x402 settings: ${missing.join(', ')}.`);
  const network = config.X402_NETWORK ?? 'eip155:84532';
  validateNetwork(network);
  const publicBaseUrl = requiredPublicBaseUrl(config);
  const operatorPayers = parseOperatorPayers(config.X402_OPERATOR_PAYERS);
  const asset = assertAsset(network, config.X402_ASSET as string);
  const payTo = assertPayee(network, config.X402_PAY_TO as string);
  const primary = {
    network, asset, assetName: config.X402_ASSET_NAME ?? 'USDC', assetVersion: config.X402_ASSET_VERSION ?? '2',
  };
  const judgeNetworks = judgeNetworkAssets(config, network, primary);
  return {
    facilitatorUrl: (config.X402_FACILITATOR_URL as string).trim(),
    network,
    asset,
    assetName: primary.assetName,
    assetVersion: primary.assetVersion,
    judgeNetworks,
    operatorPayers,
    payTo,
    maxTimeoutSeconds: config.X402_MAX_TIMEOUT_SECONDS ?? 60,
    publicBaseUrl,
  };
};
