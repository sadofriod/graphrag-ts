import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'bun:test';
import { loadConfig } from '../config.ts';
import { createLogger } from '../log.ts';
import type { IndexStore } from '../store.ts';
import { startMcpServer } from '../mcp.ts';
import { x402Settings } from './settings.ts';

const evmAddress = '0x1234567890abcdef1234567890abcdef12345678';
const enabledConfig = (overrides: Record<string, string> = {}) => loadConfig({
  DATABASE_URL: 'postgresql://localhost/unused',
  X402_ENABLED: 'true',
  X402_FACILITATOR_URL: ' https://facilitator.example.test/ ',
  X402_ASSET: evmAddress,
  X402_PAY_TO: evmAddress,
  X402_DATASETS_FILE: './datasets.json',
  X402_NETWORK: 'eip155:8453',
  X402_PUBLIC_BASE_URL: 'https://pay.example.test',
  ...overrides,
});

describe('x402 settings', () => {
  test('remains disabled when the flag is false or absent', () => {
    expect(x402Settings(loadConfig({ DATABASE_URL: 'postgresql://localhost/unused' }))).toBeUndefined();
    expect(x402Settings(loadConfig({ DATABASE_URL: 'postgresql://localhost/unused', X402_ENABLED: 'false' }))).toBeUndefined();
  });

  test('loads self-hosted PayAI-style settings without CDP credentials', () => {
    const config = enabledConfig();
    expect(config.CDP_API_KEY_ID).toBeUndefined();
    expect(config.CDP_API_KEY_SECRET).toBeUndefined();
    expect(x402Settings(config)).toEqual({
      facilitatorUrl: 'https://facilitator.example.test/', network: 'eip155:8453', asset: evmAddress,
      assetName: 'USDC', assetVersion: '2', payTo: evmAddress, maxTimeoutSeconds: 60,
      judgeNetworks: [
        { network: 'eip155:8453', asset: evmAddress, assetName: 'USDC', assetVersion: '2' },
        { network: 'eip155:42161', asset: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', assetName: 'USD Coin', assetVersion: '2' },
      ],
      publicBaseUrl: 'https://pay.example.test',
    });
  });

  test('allows explicit judge network overrides, canonical Arbitrum USDC, asset validation, and deduplication', () => {
    const explicit = x402Settings(enabledConfig({ X402_JUDGE_EXTRA_NETWORKS: ` eip155:42161, eip155:8453, eip155:42161=${evmAddress} ` }));
    expect(explicit?.judgeNetworks).toEqual([
      { network: 'eip155:8453', asset: evmAddress, assetName: 'USDC', assetVersion: '2' },
      { network: 'eip155:42161', asset: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', assetName: 'USD Coin', assetVersion: '2' },
    ]);
    expect(x402Settings(enabledConfig({ X402_JUDGE_EXTRA_NETWORKS: `eip155:42161=${evmAddress}` }))?.judgeNetworks[1]).toEqual({
      network: 'eip155:42161', asset: evmAddress, assetName: 'USDC', assetVersion: '2',
    });
    expect(() => x402Settings(enabledConfig({ X402_JUDGE_EXTRA_NETWORKS: 'eip155:10' })))
      .toThrow('eip155:10 in X402_JUDGE_EXTRA_NETWORKS');
  });

  test('only defaults Arbitrum when the primary network is Base mainnet', () => {
    expect(x402Settings(enabledConfig({ X402_NETWORK: 'eip155:84532' }))?.judgeNetworks).toHaveLength(1);
  });

  test('requires base settings and validates network family before addresses', () => {
    expect(() => x402Settings(enabledConfig({ X402_DATASETS_FILE: '' }))).toThrow('X402_DATASETS_FILE');
    expect(() => x402Settings(enabledConfig({ X402_NETWORK: 'ethereum:mainnet' }))).toThrow('X402_NETWORK must be a CAIP-2 network');
    expect(() => x402Settings(enabledConfig({ X402_ASSET: 'not-an-address' }))).toThrow('X402_ASSET');
    expect(() => x402Settings(enabledConfig({ X402_PAY_TO: 'not-an-address' }))).toThrow('X402_PAY_TO');
  });

  test('rejects Solana networks until transaction replay protection is implemented', () => {
    const solanaAddress = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    expect(() => x402Settings(enabledConfig({
      X402_NETWORK: `solana:${solanaAddress}`,
      X402_ASSET: solanaAddress,
      X402_PAY_TO: solanaAddress,
      X402_ASSET_NAME: 'Token',
      X402_ASSET_VERSION: '3',
      X402_MAX_TIMEOUT_SECONDS: '30',
      X402_PUBLIC_BASE_URL: ' https://public.example.test/ ',
    }))).toThrow('Solana x402 payments are not supported yet.');
  });

  test('requires the public base URL for the paid-hostname boundary', () => {
    expect(() => x402Settings(enabledConfig({ X402_PUBLIC_BASE_URL: '' }))).toThrow('X402_PUBLIC_BASE_URL');
  });

  test('requires a facilitator address when a registry uses upto pricing', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ kinds: [
      { x402Version: 2, scheme: 'exact', network: 'eip155:84532' },
    ] }))) as unknown as typeof fetch;
    const config = loadConfig({
      DATABASE_URL: 'postgresql://localhost/unused', MCP_HOST: '127.0.0.1', MCP_PORT: '39147',
      X402_ENABLED: 'true', X402_FACILITATOR_URL: 'https://facilitator.example.test',
      X402_ASSET: evmAddress, X402_PAY_TO: evmAddress,
      X402_DATASETS_FILE: fileURLToPath(new URL('../../datasets.example.json', import.meta.url)),
      X402_NETWORK: 'eip155:84532',
      X402_PUBLIC_BASE_URL: 'https://pay.example.test',
    });
    try {
      await expect(startMcpServer({} as IndexStore, config, createLogger('error'))).rejects.toThrow('X402 upto pricing requires a facilitator');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('starts without upto pricing when the facilitator /supported endpoint is unreachable', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    const config = {
      ...loadConfig({
        DATABASE_URL: 'postgresql://localhost/unused', MCP_HOST: '127.0.0.1',
        X402_ENABLED: 'true', X402_FACILITATOR_URL: 'https://facilitator.example.test',
        X402_ASSET: evmAddress, X402_PAY_TO: evmAddress,
        X402_DATASETS_FILE: fileURLToPath(new URL('../../datasets.example.json', import.meta.url)),
        X402_NETWORK: 'eip155:84532',
        X402_PUBLIC_BASE_URL: 'https://pay.example.test',
      }),
      MCP_PORT: 0,
    };
    const warnings: Array<{ message: string; fields?: Record<string, unknown> }> = [];
    const logger = {
      info: () => undefined,
      warn: (message: string, fields?: Record<string, unknown>) => warnings.push({ message, ...(fields ? { fields } : {}) }),
      error: () => undefined,
    };
    let close: (() => Promise<void>) | undefined;
    try {
      close = await startMcpServer({} as IndexStore, config, logger);
      expect(typeof close).toBe('function');
      expect(warnings).toEqual([{
        message: 'Facilitator /supported is unreachable at startup; starting without upto pricing.',
        fields: { error_name: 'Error' },
      }]);
    } finally {
      globalThis.fetch = originalFetch;
      if (close) await close();
    }
  });
});
