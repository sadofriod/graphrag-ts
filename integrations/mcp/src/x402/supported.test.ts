import { describe, expect, test } from 'bun:test';
import { findUptoFacilitatorAddress, fetchSupportedKinds } from './supported.ts';
import type { FacilitatorClient } from './facilitator.ts';

const kinds = [
  { x402Version: 1, scheme: 'upto', network: 'eip155:84532', extra: { facilitatorAddress: '0xv1' } },
  { x402Version: 2, scheme: 'exact', network: 'eip155:84532', extra: { facilitatorAddress: '0xexact' } },
  { x402Version: 2, scheme: 'upto', network: 'eip155:8453', extra: { facilitatorAddress: '0xbase' } },
  { x402Version: 2, scheme: 'upto', network: 'eip155:84532', extra: { facilitatorAddress: '0xsepolia' } },
];

describe('facilitator supported kinds', () => {
  test('fetches raw kinds using the facilitator request callback', async () => {
    const facilitator: FacilitatorClient = {
      verify: async () => ({ isValid: true, payer: '0xbuyer' }),
      settle: async () => ({ success: true, transaction: '0xtx', network: 'eip155:84532' }),
      request: async (path) => ({ status: 200, json: { kinds: path === 'supported' ? kinds : [] } }),
    };
    const response = await fetchSupportedKinds({ facilitatorUrl: 'https://facilitator.example', facilitator });
    expect(response.kinds).toEqual(kinds);
  });

  test('selects the v2 upto address for the requested network', () => {
    expect(findUptoFacilitatorAddress(kinds, 'eip155:8453')).toBe('0xbase');
    expect(findUptoFacilitatorAddress(kinds, 'eip155:84532')).toBe('0xsepolia');
  });

  test('ignores v1 kinds and returns undefined when absent', () => {
    expect(findUptoFacilitatorAddress([kinds[0]!], 'eip155:84532')).toBeUndefined();
    expect(findUptoFacilitatorAddress(kinds, 'eip155:1')).toBeUndefined();
  });
});
