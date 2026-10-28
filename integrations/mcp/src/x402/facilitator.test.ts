import { describe, expect, test } from 'bun:test';
import { createFacilitatorClient, X402FacilitatorError } from './facilitator.ts';
import type { VerifyRequest } from './types.ts';

const request: VerifyRequest = {
  paymentPayload: { x402Version: 2, accepted: { scheme: 'exact', network: 'eip155:84532', amount: '20000', asset: '0xasset', payTo: '0xreceiver', maxTimeoutSeconds: 60 }, payload: { signature: 'secret' } },
  paymentRequirements: { scheme: 'exact', network: 'eip155:84532', amount: '20000', asset: '0xasset', payTo: '0xreceiver', maxTimeoutSeconds: 60 },
};

describe('x402 facilitator client', () => {
  test('posts the exact body and validates verify/settle responses', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetchImpl = async (input: string, init: RequestInit): Promise<Response> => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify(calls.length === 1
        ? { isValid: true, payer: '0xpayer' }
        : { success: false, transaction: '', network: 'eip155:84532', errorReason: 'rejected' }), { status: 200 });
    };
    const client = createFacilitatorClient({ url: 'https://facilitator.example/', fetchImpl });
    expect(await client.verify(request)).toEqual({ isValid: true, payer: '0xpayer' });
    expect(await client.settle(request)).toMatchObject({ success: false, errorReason: 'rejected' });
    expect(calls.map((call) => call.url)).toEqual(['https://facilitator.example/verify', 'https://facilitator.example/settle']);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ x402Version: 2, paymentPayload: request.paymentPayload, paymentRequirements: request.paymentRequirements });
    expect(calls[0]?.init?.headers).toEqual({ 'content-type': 'application/json' });
  });

  test('surfaces HTTP and malformed response errors without echoing payment data', async () => {
    const http = createFacilitatorClient({ url: 'https://facilitator.example', fetchImpl: async () => new Response('private response', { status: 500 }) });
    await expect(http.verify(request)).rejects.toMatchObject({ name: 'X402FacilitatorError', code: 'FACILITATOR_HTTP', status: 500 });
    const malformed = createFacilitatorClient({ url: 'https://facilitator.example', fetchImpl: async () => new Response('{broken', { status: 200 }) });
    await expect(malformed.verify(request)).rejects.toMatchObject({ code: 'FACILITATOR_INVALID_RESPONSE' });
    await expect(http.verify(request)).rejects.not.toThrow('secret');
  });

  test('parses structured payment rejections returned with HTTP error statuses', async () => {
    const verify = createFacilitatorClient({
      url: 'https://facilitator.example',
      fetchImpl: async () => new Response(JSON.stringify({ isValid: false, invalidReason: 'invalid_signature' }), { status: 402 }),
    });
    await expect(verify.verify(request)).resolves.toMatchObject({ isValid: false, invalidReason: 'invalid_signature' });

    const settle = createFacilitatorClient({
      url: 'https://facilitator.example',
      fetchImpl: async () => new Response(JSON.stringify({ success: false, errorReason: 'not_authorized', network: 'eip155:84532' }), { status: 403 }),
    });
    await expect(settle.settle(request)).resolves.toMatchObject({ success: false, transaction: '', errorReason: 'not_authorized' });

    const unshaped = createFacilitatorClient({
      url: 'https://facilitator.example',
      fetchImpl: async () => new Response(JSON.stringify({ success: false, errorReason: 'invalid signature' }), { status: 400 }),
    });
    await expect(unshaped.verify(request)).rejects.toMatchObject({ code: 'FACILITATOR_HTTP', status: 400 });
  });

  test('aborts requests after the configured timeout', async () => {
    const client = createFacilitatorClient({
      url: 'https://facilitator.example', timeoutMs: 1,
      fetchImpl: (_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }),
    });
    await expect(client.verify(request)).rejects.toBeInstanceOf(X402FacilitatorError);
  });
});
