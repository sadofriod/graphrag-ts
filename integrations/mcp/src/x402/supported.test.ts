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

  test('fetches supported kinds over HTTP and rejects malformed bodies and non-2xx status', async () => {
    const facilitator: FacilitatorClient = {
      verify: async () => ({ isValid: true }),
      settle: async () => ({ success: true, transaction: 'tx', network: 'eip155:84532' }),
    };
    const good = await fetchSupportedKinds({
      facilitatorUrl: 'https://facilitator.example/', facilitator,
      fetchImpl: async (url, init) => {
        expect(url).toBe('https://facilitator.example/supported');
        expect(init.method).toBe('GET');
        return new Response(JSON.stringify({ kinds }));
      },
    });
    expect(good.kinds).toEqual(kinds);
    await expect(fetchSupportedKinds({ facilitatorUrl: 'https://facilitator.example', facilitator,
      fetchImpl: async () => new Response('{', { status: 200 }),
    })).rejects.toThrow('malformed /supported JSON');
    await expect(fetchSupportedKinds({ facilitatorUrl: 'https://facilitator.example', facilitator,
      fetchImpl: async () => new Response('{}', { status: 503 }),
    })).rejects.toThrow('HTTP 503');
    await expect(fetchSupportedKinds({ facilitatorUrl: 'https://facilitator.example', facilitator,
      fetchImpl: async () => new Response(JSON.stringify({ kinds: 'not an array' })),
    })).rejects.toThrow('invalid /supported response');
  });

  test('selects the v2 upto address for the requested network', () => {
    expect(findUptoFacilitatorAddress(kinds, 'eip155:8453')).toBe('0xbase');
    expect(findUptoFacilitatorAddress(kinds, 'eip155:84532')).toBe('0xsepolia');
  });

  test('ignores v1 kinds and returns undefined when absent', () => {
    expect(findUptoFacilitatorAddress([kinds[0]!], 'eip155:84532')).toBeUndefined();
    expect(findUptoFacilitatorAddress(kinds, 'eip155:1')).toBeUndefined();
    expect(findUptoFacilitatorAddress([{ x402Version: 2, scheme: 'exact', network: 'eip155:84532' }], 'eip155:84532')).toBeUndefined();
  });
});
