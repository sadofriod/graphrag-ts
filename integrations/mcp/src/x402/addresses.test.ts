import { describe, expect, test } from 'bun:test';
import { loadConfig } from '../config.ts';
import { assertAsset, assertPayee, isEvmAddress, isSolanaAddress, networkFamily } from './addresses.ts';
import { x402Settings } from './settings.ts';

const evmAddress = '0x1234567890abcdef1234567890abcdef12345678';
const solanaAddress = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const tronAddress = 'THkrjwQ6Pj35CH98M223Si93f6saRAb6DY';

describe('x402 address validation', () => {
  test('accepts EVM payees and assets', () => {
    expect(isEvmAddress(evmAddress)).toBe(true);
    expect(assertPayee('eip155:8453', ` ${evmAddress} `)).toBe(evmAddress);
    expect(assertAsset('eip155:8453', evmAddress)).toBe(evmAddress);
  });

  test('rejects a Tron payee without echoing its full value', () => {
    expect(isEvmAddress(tronAddress)).toBe(false);
    let message = '';
    try {
      assertPayee('eip155:8453', tronAddress);
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toContain('X402_PAY_TO');
    expect(message).not.toContain(tronAddress);
  });

  test('accepts Solana pubkeys and mint addresses', () => {
    expect(isSolanaAddress(solanaAddress)).toBe(true);
    expect(assertPayee(`solana:${solanaAddress}`, solanaAddress)).toBe(solanaAddress);
    expect(assertAsset(`solana:${solanaAddress}`, solanaAddress)).toBe(solanaAddress);
  });

  test('rejects short and invalid base58 values', () => {
    expect(isSolanaAddress('1234')).toBe(false);
    expect(isSolanaAddress(`${solanaAddress}0`)).toBe(false);
    expect(() => assertPayee(`solana:${solanaAddress}`, '1234')).toThrow('X402_PAY_TO');
  });

  test('identifies EVM, Solana and unknown network families', () => {
    expect(networkFamily('eip155:8453')).toBe('evm');
    expect(networkFamily(`solana:${solanaAddress}`)).toBe('solana');
    expect(networkFamily('tron:mainnet')).toBe('other');
  });

  test('rejects Tron payees while loading self-hosted settings', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgresql://localhost/unused',
      X402_ENABLED: 'true',
      X402_FACILITATOR_URL: 'https://facilitator.example.test',
      X402_ASSET: evmAddress,
      X402_PAY_TO: tronAddress,
      X402_DATASETS_FILE: './datasets.json',
      X402_NETWORK: 'eip155:8453',
      X402_PUBLIC_BASE_URL: 'https://pay.example.test',
    });
    expect(() => x402Settings(config)).toThrow('X402_PAY_TO');
  });
});
