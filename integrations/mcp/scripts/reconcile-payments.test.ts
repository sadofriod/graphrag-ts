import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import type { Pool } from 'pg';
import { configuredFacilitator, markSettled, persistRetryResult } from './reconcile-payments.ts';
import type { PaymentRequirements, VerifyRequest } from '../src/x402/types.ts';

const requirements: PaymentRequirements = {
  scheme: 'upto', network: 'eip155:84532', amount: '40000', asset: '0xasset', payTo: '0xreceiver', maxTimeoutSeconds: 60,
};
const verifyRequest: VerifyRequest = {
  paymentPayload: { x402Version: 2, accepted: requirements, payload: {} },
  paymentRequirements: requirements,
};

const mockPool = (query: (sql: string, params?: readonly unknown[]) => Promise<{ rowCount?: number | null; rows: unknown[] }>) =>
  ({ query }) as unknown as Pool;

describe('x402 payment reconciliation', () => {
  test('keeps rejected retries settlement-unknown until the transaction is reconciled', async () => {
    let statement = '';
    const pool = mockPool(async (sql) => { statement = sql; return { rowCount: 1, rows: [] }; });
    await persistRetryResult(pool, 'payment-id', {
      answer_json: { payment: { amount: '40000' } }, requirements_json: requirements,
      amount_authorized: '100000', settle_attempts: 2,
    }, { success: false, transaction: '', network: requirements.network, errorReason: 'nonce already used' });
    expect(statement).toContain("status = 'settlement_unknown'");
    expect(statement).toContain('settle_attempts = settle_attempts + 1');
    expect(statement).not.toContain("status = 'failed'");
  });

  test('recovers the saved settlement amount instead of the authorization cap', async () => {
    let params: readonly unknown[] = [];
    let statement = '';
    const pool = mockPool(async (sql, values) => {
      statement = sql;
      params = values ?? [];
      return { rowCount: 1, rows: [] };
    });
    await persistRetryResult(pool, 'payment-id', {
      answer_json: { payment: { amount: '40000' } }, requirements_json: requirements,
      amount_authorized: '100000', settle_attempts: 0,
    }, { success: true, transaction: '0xtx', network: requirements.network });
    expect(statement).toContain("NULLIF(requirements_json->>'amount', '')::numeric");
    expect(statement).toContain('amount_authorized');
    expect(JSON.parse(String(params[4]))).toMatchObject({ payment: { amount: '40000', transaction: '0xtx' } });
  });

  test('records the persisted settlement amount when an operator confirms a transaction', async () => {
    let statement = '';
    const pool = mockPool(async (sql) => { statement = sql; return { rowCount: 1, rows: [] }; });
    await markSettled(pool, 'payment-id', '0xtx');
    expect(statement).toContain("NULLIF(requirements_json->>'amount', '')::numeric");
  });

  test('uses CDP authentication for reconciliation retries when configured', async () => {
    const pair = generateKeyPairSync('ed25519');
    const privateDer = pair.privateKey.export({ format: 'der', type: 'pkcs8' });
    const publicDer = pair.publicKey.export({ format: 'der', type: 'spki' });
    const originalFetch = globalThis.fetch;
    const originalId = process.env.CDP_API_KEY_ID;
    const originalSecret = process.env.CDP_API_KEY_SECRET;
    let authorization = '';
    process.env.CDP_API_KEY_ID = 'test-key';
    process.env.CDP_API_KEY_SECRET = Buffer.concat([
      privateDer.subarray(privateDer.length - 32),
      publicDer.subarray(publicDer.length - 32),
    ]).toString('base64');
    globalThis.fetch = (async (_input, init) => {
      authorization = new Headers(init?.headers).get('authorization') ?? '';
      return new Response(JSON.stringify({ isValid: true, payer: '0xbuyer' }));
    }) as typeof fetch;
    try {
      const facilitator = configuredFacilitator('https://api.cdp.coinbase.com/platform/v2/x402');
      await facilitator.verify(verifyRequest);
      expect(authorization.startsWith('Bearer ')).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalId === undefined) delete process.env.CDP_API_KEY_ID;
      else process.env.CDP_API_KEY_ID = originalId;
      if (originalSecret === undefined) delete process.env.CDP_API_KEY_SECRET;
      else process.env.CDP_API_KEY_SECRET = originalSecret;
    }
  });
});
