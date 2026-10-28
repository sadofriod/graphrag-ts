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
    const now = 1_700_000_000;
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
    expect(claims.nbf).toBe(now);
    expect(claims.exp).toBe(now + 120);
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

  test('signs ES256 JWTs from PKCS#8 PEM keys using JOSE-width signatures', async () => {
    const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const pemSecret = String(pair.privateKey.export({ format: 'pem', type: 'pkcs8' }));
    for (const apiKeySecret of [
      pemSecret,
      Buffer.from(pemSecret).toString('base64'),
      pair.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    ]) {
      const token = await signCdpJwt({ apiKeyId: 'es256-key', apiKeySecret, method: 'get', host: 'facilitator.test', path: '/supported', now: 123, expiresInSeconds: 30 });
      const [headerPart, claimsPart, signaturePart] = token.split('.');
      expect(decode(headerPart as string)).toMatchObject({ alg: 'ES256', kid: 'es256-key', typ: 'JWT' });
      expect(decode(claimsPart as string)).toMatchObject({ nbf: 123, exp: 153, uris: ['GET facilitator.test/supported'] });
      expect(Buffer.from(signaturePart as string, 'base64url')).toHaveLength(64);
      expect(cryptoVerify('sha256', Buffer.from(`${headerPart}.${claimsPart}`), { key: pair.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signaturePart as string, 'base64url'))).toBe(true);
    }
  });

  test('maps missing or invalid signing secrets to a safe request error', async () => {
    const client = createCdpFacilitatorClient({ apiKeyId: 'key', apiKeySecret: '', fetchImpl: async () => new Response('{}') });
    await expect(client.verify(request)).rejects.toMatchObject({ code: 'FACILITATOR_REQUEST_FAILED' });
  });

  test('accepts shaped verify and settle rejections over HTTP 402', async () => {
    const credentials = makeEd25519Credentials();
    const verifyClient = createCdpFacilitatorClient({
      ...credentials,
      fetchImpl: async () => new Response(JSON.stringify({ isValid: false, invalidReason: 'invalidReason passthrough', payer: '0xbuyer' }), { status: 402 }),
    });
    await expect(verifyClient.verify(request)).resolves.toMatchObject({ isValid: false, invalidReason: 'invalidReason passthrough' });

    const settleClient = createCdpFacilitatorClient({
      ...credentials,
      fetchImpl: async () => new Response(JSON.stringify({ success: false, errorReason: 'not_authorized', network: 'eip155:84532' }), { status: 402 }),
    });
    await expect(settleClient.settle(request)).resolves.toMatchObject({ success: false, transaction: '', errorReason: 'not_authorized' });
  });

  test('supports authenticated GET requests and safely wraps malformed supported responses', async () => {
    const credentials = makeEd25519Credentials();
    let target = '';
    let method = '';
    const client = createCdpFacilitatorClient({
      ...credentials,
      baseUrl: 'https://api.cdp.coinbase.com/platform/v2/x402/',
      fetchImpl: async (input, init) => {
        target = input;
        method = init.method ?? '';
        return new Response(JSON.stringify({ kinds: [{ x402Version: 2 }] }), { status: 200 });
      },
    });
    await expect(client.request?.('/supported')).resolves.toEqual({ status: 200, json: { kinds: [{ x402Version: 2 }] } });
    expect(target).toBe('https://api.cdp.coinbase.com/platform/v2/x402/supported');
    expect(method).toBe('GET');

    const malformed = createCdpFacilitatorClient({ ...credentials, fetchImpl: async () => new Response('{') });
    await expect(malformed.request?.('supported')).rejects.toMatchObject({ code: 'FACILITATOR_REQUEST_FAILED' });
  });
});
