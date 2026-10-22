import { describe, expect, test } from 'bun:test';
import { decodePaymentHeader, encodePaymentHeader, paymentPayloadSchema, paymentRequiredSchema, X402FormatError } from './types.ts';

const requirements = { scheme: 'exact', network: 'eip155:84532', amount: '20000', asset: '0xasset', payTo: '0xreceiver', maxTimeoutSeconds: 60, extra: { name: 'USDC' } };

describe('x402 v2 wire objects', () => {
  test('round-trips full PaymentRequired and PaymentPayload headers', () => {
    const required = { x402Version: 2 as const, resource: { url: 'https://example.com/query' }, accepts: [requirements], extensions: { bazaar: { info: { title: 'query' }, schema: {} } } };
    const payload = { x402Version: 2 as const, resource: { url: 'https://example.com/query' }, accepted: requirements, payload: { signature: 'sig', authorization: { value: '20000', nonce: 'n' } }, extensions: {} };
    expect(paymentRequiredSchema.parse(decodePaymentHeader(encodePaymentHeader(required)))).toEqual(required);
    expect(paymentPayloadSchema.parse(decodePaymentHeader(encodePaymentHeader(payload)))).toEqual(payload);
  });

  test('rejects oversized, invalid base64, invalid JSON, and v1 headers', () => {
    expect(() => decodePaymentHeader('A'.repeat(30_000))).toThrow(X402FormatError);
    expect(() => decodePaymentHeader('%%%')).toThrow(X402FormatError);
    expect(() => decodePaymentHeader(Buffer.from('{bad', 'utf8').toString('base64'))).toThrow(X402FormatError);
    expect(() => paymentRequiredSchema.parse({ x402Version: 1, accepts: [requirements] })).toThrow();
    expect(() => paymentPayloadSchema.parse({ x402Version: 1, accepted: requirements, payload: {} })).toThrow();
  });
});
