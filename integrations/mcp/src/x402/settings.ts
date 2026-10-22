import type { AppConfig } from '../config.ts';

export type X402Settings = {
  readonly facilitatorUrl: string;
  readonly network: string;
  readonly asset: string;
  readonly assetName: string;
  readonly assetVersion: string;
  readonly payTo: string;
  readonly maxTimeoutSeconds: number;
  readonly publicBaseUrl?: string;
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
  return {
    facilitatorUrl: (config.X402_FACILITATOR_URL as string).trim(),
    network: config.X402_NETWORK ?? 'eip155:84532',
    asset: (config.X402_ASSET as string).trim(),
    assetName: config.X402_ASSET_NAME ?? 'USDC',
    assetVersion: config.X402_ASSET_VERSION ?? '2',
    payTo: (config.X402_PAY_TO as string).trim(),
    maxTimeoutSeconds: config.X402_MAX_TIMEOUT_SECONDS ?? 60,
    ...(config.X402_PUBLIC_BASE_URL ? { publicBaseUrl: config.X402_PUBLIC_BASE_URL.trim() } : {}),
  };
};
