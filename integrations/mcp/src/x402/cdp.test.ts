import { generateKeyPairSync, verify as cryptoVerify } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import { createCdpFacilitatorClient, signCdpJwt } from './cdp.ts';
import type { VerifyRequest } from './types.ts';

const makeEd25519Credentials = (): { readonly apiKeyId: string; readonly apiKeySecret: string; readonly publicKey: ReturnType<typeof generateKeyPairSync>['publicKey'] } => {
  const pair = generateKeyPairSync('ed25519');
  const privateDer = pair.privateKey.export({ format: 'der', type: 'pkcs8' });
  const publicDer = pair.publicKey.export({ format: 'der', type: 'spki' });
  const seed = privateDer.subarray(privateDer.length - 32);
  const publicBytes = publicDer.subarray(publicDer.length - 32);
  return {
    apiKeyId: 'organizations/test/apiKeys/key-id',
    apiKeySecret: Buffer.concat([seed, publicBytes]).toString('base64'),
    publicKey: pair.publicKey,
  };
};

const decode = (part: string): Record<string, unknown> => JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;

const request: VerifyRequest = {
  paymentPayload: {
    x402Version: 2,
    accepted: { scheme: 'exact', network: 'eip155:84532', amount: '20000', asset: '0xasset', payTo: '0xreceiver', maxTimeoutSeconds: 60 },
    payload: { signature: 'payment-data' },
  },
  paymentRequirements: { scheme: 'exact', network: 'eip155:84532', amount: '20000', asset: '0xasset', payTo: '0xreceiver', maxTimeoutSeconds: 60 },
};

describe('Coinbase CDP facilitator', () => {
  test('signs a request-bound Ed25519 JWT with the portal secret format', async () => {
    const credentials = makeEd25519Credentials();
    const now = Math.floor(Date.now() / 1000);
    const token = await signCdpJwt({ ...credentials, method: 'POST', host: 'api.cdp.coinbase.com', path: '/platform/v2/x402/verify', now });
    const [encodedHeader, encodedClaims, encodedSignature] = token.split('.');
    expect(encodedHeader).toBeDefined();
    expect(encodedClaims).toBeDefined();
    expect(encodedSignature).toBeDefined();
    const header = decode(encodedHeader as string);
    const claims = decode(encodedClaims as string);
    expect(header).toMatchObject({ alg: 'EdDSA', kid: credentials.apiKeyId, typ: 'JWT' });
    expect(header.nonce).toMatch(/^[0-9a-f]{16}$/);
    expect(claims).toMatchObject({
      iss: 'cdp', aud: ['cdp_service'], sub: credentials.apiKeyId,
      uris: ['POST api.cdp.coinbase.com/platform/v2/x402/verify'],
    });
    expect(claims.nbf).toBeLessThanOrEqual(now);
    expect(claims.exp).toBeGreaterThanOrEqual(now);
    expect((claims.exp as number) - (claims.nbf as number)).toBe(120);
    expect(cryptoVerify(null, Buffer.from(`${encodedHeader}.${encodedClaims}`), credentials.publicKey, Buffer.from(encodedSignature as string, 'base64url'))).toBe(true);
  });

  test('sends an authorized request to the CDP endpoint and maps HTTP failures safely', async () => {
    const credentials = makeEd25519Credentials();
    let requestedUrl = '';
    let authorization = '';
    const client = createCdpFacilitatorClient({
      ...credentials,
      fetchImpl: async (input, init) => {
        requestedUrl = input;
        authorization = new Headers(init.headers).get('authorization') ?? '';
        return new Response('private response', { status: 401 });
      },
    });
    let errorMessage = '';
    try {
      await client.verify(request);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
      expect(error).toMatchObject({ code: 'FACILITATOR_HTTP', status: 401 });
    }
    expect(requestedUrl).toBe('https://api.cdp.coinbase.com/platform/v2/x402/verify');
    expect(authorization.startsWith('Bearer ')).toBe(true);
    expect(errorMessage).not.toContain(credentials.apiKeySecret);
    expect(errorMessage).not.toContain(authorization.slice('Bearer '.length));
  });

  test('returns shaped invalid verify responses from HTTP 400', async () => {
    const client = createCdpFacilitatorClient({
      ...makeEd25519Credentials(),
      fetchImpl: async () => new Response(JSON.stringify({ isValid: false, invalidReason: 'invalid_exact_evm_payload_signature' }), { status: 400 }),
    });

    await expect(client.verify(request)).resolves.toMatchObject({ isValid: false, invalidReason: 'invalid_exact_evm_payload_signature' });
  });

  test('returns shaped failed settle responses from HTTP 400', async () => {
    const client = createCdpFacilitatorClient({
      ...makeEd25519Credentials(),
      fetchImpl: async () => new Response(JSON.stringify({
        success: false,
        errorReason: 'invalid_exact_evm_payload_signature',
        network: 'eip155:84532',
        payer: '0xbuyer',
        errorMessage: 'Signature is invalid.',
      }), { status: 400 }),
    });

    await expect(client.settle(request)).resolves.toMatchObject({ success: false, errorReason: 'invalid_exact_evm_payload_signature', network: 'eip155:84532' });
  });

  test('keeps HTTP 500 errors as FACILITATOR_HTTP', async () => {
    const client = createCdpFacilitatorClient({
      ...makeEd25519Credentials(),
      fetchImpl: async () => new Response('{}', { status: 500 }),
    });

    await expect(client.verify(request)).rejects.toMatchObject({ code: 'FACILITATOR_HTTP', status: 500 });
  });

  test('keeps unshaped HTTP 400 verify responses as FACILITATOR_HTTP', async () => {
    const client = createCdpFacilitatorClient({
      ...makeEd25519Credentials(),
      fetchImpl: async () => new Response(JSON.stringify({ success: false, errorReason: 'invalid signature' }), { status: 400 }),
    });

    await expect(client.verify(request)).rejects.toMatchObject({ code: 'FACILITATOR_HTTP', status: 400 });
  });
});
