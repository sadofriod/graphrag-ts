import { describe, expect, test } from 'bun:test';
import { nonceFromPayload, parsePaymentPayload } from './payload.ts';
import { decodePaymentHeader, encodePaymentHeader, paymentPayloadSchema, paymentRequiredSchema, X402FormatError } from './types.ts';

const requirements = { scheme: 'exact', network: 'eip155:84532', amount: '20000', asset: '0xasset', payTo: '0xreceiver', maxTimeoutSeconds: 60, extra: { name: 'USDC' } };

describe('x402 v2 wire objects', () => {
  test('round-trips full PaymentRequired and PaymentPayload headers', () => {
    const required = { x402Version: 2 as const, resource: { url: 'https://example.com/query' }, accepts: [requirements], extensions: { bazaar: { info: { title: 'query' }, schema: {} } } };
    const payload = { x402Version: 2 as const, resource: { url: 'https://example.com/query' }, accepted: requirements, payload: { signature: 'sig', authorization: { value: '20000', nonce: 'n' } }, extensions: {} };
    expect(paymentRequiredSchema.parse(decodePaymentHeader(encodePaymentHeader(required)))).toEqual(required);
    expect(paymentPayloadSchema.parse(decodePaymentHeader(encodePaymentHeader(payload)))).toEqual(payload);
  });

  test('extracts the nonce from upto Permit2 and exact authorization payloads', () => {
    const permit2Payload = {
      x402Version: 2 as const,
      accepted: { ...requirements, scheme: 'upto' },
      payload: {
        signature: 'sig',
        permit2Authorization: {
          from: '0xpayer', permitted: { token: '0xtoken', amount: '20000' }, spender: '0xfacilitator',
          nonce: 'permit2-nonce', deadline: '123', witness: { to: '0xreceiver', facilitator: '0xfacilitator' },
        },
      },
    };
    const exactPayload = {
      x402Version: 2 as const,
      accepted: requirements,
      payload: { signature: 'sig', authorization: { value: '20000', nonce: 'exact-nonce' } },
    };

    const permit2Parsed = parsePaymentPayload(encodePaymentHeader(permit2Payload));
    const exactParsed = parsePaymentPayload(encodePaymentHeader(exactPayload));
    expect(permit2Parsed.payload).toBeDefined();
    expect(exactParsed.payload).toBeDefined();
    expect(nonceFromPayload(permit2Parsed.payload!)).toBe('permit2-nonce');
    expect(nonceFromPayload(exactParsed.payload!)).toBe('exact-nonce');
    expect(permit2Parsed.payload?.payload.permit2Authorization?.nonce).toBe('permit2-nonce');
  });

  test('rejects missing and blank authorization nonces', () => {
    const payload = (paymentPayload: Record<string, unknown>) => encodePaymentHeader({
      x402Version: 2,
      accepted: requirements,
      payload: paymentPayload,
    });
    const missingNonce = parsePaymentPayload(payload({ signature: 'sig' }));
    const blankPermit2Nonce = parsePaymentPayload(payload({ signature: 'sig', permit2Authorization: { nonce: '' } }));

    expect(missingNonce.error).toBe('Payment payload authorization is invalid.');
    expect(blankPermit2Nonce.error).toBe('Payment payload authorization is invalid.');
  });

  test('rejects oversized, invalid base64, invalid JSON, and v1 headers', () => {
    expect(() => decodePaymentHeader('A'.repeat(30_000))).toThrow(X402FormatError);
    expect(() => decodePaymentHeader('%%%')).toThrow(X402FormatError);
    expect(() => decodePaymentHeader(Buffer.from('{bad', 'utf8').toString('base64'))).toThrow(X402FormatError);
    expect(() => paymentRequiredSchema.parse({ x402Version: 1, accepts: [requirements] })).toThrow();
    expect(() => paymentPayloadSchema.parse({ x402Version: 1, accepted: requirements, payload: {} })).toThrow();
  });
});
