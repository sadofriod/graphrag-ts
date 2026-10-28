import type { AppConfig } from '../config.ts';
import { assertAsset, assertPayee } from './addresses.ts';

export type X402Settings = {
  readonly facilitatorUrl: string;
  readonly network: string;
  readonly asset: string;
  readonly assetName: string;
  readonly assetVersion: string;
  readonly payTo: string;
  readonly maxTimeoutSeconds: number;
  readonly publicBaseUrl?: string;
  readonly uptoFacilitatorAddress?: string;
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
  const asset = assertAsset(network, config.X402_ASSET as string);
  const payTo = assertPayee(network, config.X402_PAY_TO as string);
  return {
    facilitatorUrl: (config.X402_FACILITATOR_URL as string).trim(),
    network,
    asset,
    assetName: config.X402_ASSET_NAME ?? 'USDC',
    assetVersion: config.X402_ASSET_VERSION ?? '2',
    payTo,
    maxTimeoutSeconds: config.X402_MAX_TIMEOUT_SECONDS ?? 60,
    publicBaseUrl,
  };
};
