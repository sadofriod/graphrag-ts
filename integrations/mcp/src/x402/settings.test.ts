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
    });
  });

  test('requires base settings and validates network family before addresses', () => {
    expect(() => x402Settings(enabledConfig({ X402_DATASETS_FILE: '' }))).toThrow('X402_DATASETS_FILE');
    expect(() => x402Settings(enabledConfig({ X402_NETWORK: 'ethereum:mainnet' }))).toThrow('X402_NETWORK must be a CAIP-2 network');
    expect(() => x402Settings(enabledConfig({ X402_ASSET: 'not-an-address' }))).toThrow('X402_ASSET');
    expect(() => x402Settings(enabledConfig({ X402_PAY_TO: 'not-an-address' }))).toThrow('X402_PAY_TO');
  });

  test('validates a syntactically valid Solana network and applies optional overrides', () => {
    const solanaAddress = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    expect(x402Settings(enabledConfig({
      X402_NETWORK: `solana:${solanaAddress}`,
      X402_ASSET: solanaAddress,
      X402_PAY_TO: solanaAddress,
      X402_ASSET_NAME: 'Token',
      X402_ASSET_VERSION: '3',
      X402_MAX_TIMEOUT_SECONDS: '30',
      X402_PUBLIC_BASE_URL: ' https://public.example.test/ ',
    }))).toMatchObject({
      network: `solana:${solanaAddress}`, assetName: 'Token', assetVersion: '3', maxTimeoutSeconds: 30,
      publicBaseUrl: 'https://public.example.test/',
    });
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
    });
    try {
      await expect(startMcpServer({} as IndexStore, config, createLogger('error'))).rejects.toThrow('X402 upto pricing requires a facilitator');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
