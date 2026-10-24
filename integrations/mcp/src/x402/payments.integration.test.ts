import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { createStore } from '../store.ts';
import type { BeginPaymentInput } from './payments.ts';

// Deliberately not MCP_TEST_DATABASE_URL: that one points at a fully migrated
// core schema (Prisma-managed). This suite needs only the two payment migrations,
// so it can run against a bare pgvector database.
const url = process.env.X402_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const pool = url ? new Pool({ connectionString: url }) : undefined;
const store = url ? createStore(url) : undefined;
const payload = {
  x402Version: 2 as const,
  accepted: { scheme: 'exact', network: 'eip155:84532', amount: '20000', asset: '0xasset', payTo: '0xreceiver', maxTimeoutSeconds: 60 },
  payload: { authorization: { nonce: 'nonce-integration' } },
};
const requirements = payload.accepted;

const paymentInput = (overrides: Partial<BeginPaymentInput> = {}): BeginPaymentInput => ({
  id: randomUUID(), requestId: `request-${randomUUID()}`, requestHash: 'request-hash', nonce: `nonce-${randomUUID()}`,
  datasetId: 'dataset-integration', workspaceId: 'workspace-integration', mode: 'local', scheme: 'exact',
  network: 'eip155:84532', asset: '0xasset', amountAuthorized: '20000', payloadFingerprint: `fingerprint-${randomUUID()}`,
  payload, requirements, payer: '0xbuyer', ...overrides,
});

suite('x402 payment SQL migrations and recovery', () => {
  beforeAll(async () => {
    // Apply only the payment migrations: 001..007 depend on the Prisma-managed core
    // schema, and this suite is about the payment ledger, not the retrieval tables.
    for (const file of ['008_x402_payments.sql', '009_x402_settlement_recovery.sql']) {
      await pool!.query(await readFile(new URL(`../../migrations/${file}`, import.meta.url), 'utf8'));
    }
  });
  beforeEach(async () => { await pool?.query('TRUNCATE x402_payments, x402_rejected_attempts'); });
  afterAll(async () => {
    await store?.close();
    await pool?.end();
  });

  test('settles a payment while preserving its pre-settlement answer separately from the delivered body', async () => {
    const input = paymentInput();
    const payments = store!.paymentStore;
    const begun = await payments.beginPayment(input);
    expect(begun.kind).toBe('new');
    await payments.beginSettlement(input.id, { answer: 'pre-settlement answer' }, requirements);
    const settled = await payments.completePayment(input.id, {
      payer: '0xbuyer', transaction: '0xtx', amountSettled: '18000', responseBody: { answer: 'delivered response' },
      datasetVersion: 'v1', latencyMs: 9,
    });
    expect(settled).toMatchObject({
      status: 'settled', answerBody: { answer: 'pre-settlement answer' }, responseBody: { answer: 'delivered response' },
    });
    const raw = await pool!.query('SELECT status, answer_json, response_body FROM x402_payments WHERE id = $1', [input.id]);
    expect(raw.rows[0]).toMatchObject({ status: 'settled', answer_json: { answer: 'pre-settlement answer' }, response_body: { answer: 'delivered response' } });
  });

  test('enforces the partial fingerprint unique index and migrated status constraint', async () => {
    const first = paymentInput();
    const duplicate = paymentInput({ payloadFingerprint: first.payloadFingerprint });
    await store!.paymentStore.beginPayment(first);
    await expect(pool!.query(
      `INSERT INTO x402_payments
         (id, request_id, request_hash, nonce, dataset_id, workspace_id, mode, scheme, network, asset,
          amount_authorized, payload_fingerprint, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'authorized')`,
      [duplicate.id, duplicate.requestId, duplicate.requestHash, duplicate.nonce, duplicate.datasetId, duplicate.workspaceId,
        duplicate.mode, duplicate.scheme, duplicate.network, duplicate.asset, duplicate.amountAuthorized, duplicate.payloadFingerprint],
    )).rejects.toMatchObject({ code: '23505', constraint: 'x402_payments_payload_fingerprint_idx' });
    await expect(pool!.query(
      `INSERT INTO x402_payments (id, request_id, request_hash, nonce, dataset_id, mode, scheme, network, asset, amount_authorized, status)
       VALUES ($1, $2, $3, $4, $5, 'local', 'exact', 'eip155:84532', '0xasset', 1, 'pending')`,
      [randomUUID(), `pending-${randomUUID()}`, 'hash', `nonce-${randomUUID()}`, 'dataset-integration'],
    )).rejects.toMatchObject({ code: '23514', constraint: 'x402_payments_status_check' });
  });

  test('resolves old authorized and settling records through their documented recovery paths', async () => {
    const authorized = paymentInput();
    const settling = paymentInput();
    await store!.paymentStore.beginPayment(authorized);
    await store!.paymentStore.beginPayment(settling);
    await store!.paymentStore.beginSettlement(settling.id, { answer: 'saved' }, requirements);
    await pool!.query('UPDATE x402_payments SET updated_at = now() - interval \'1 hour\' WHERE id = ANY($1::uuid[])', [[authorized.id, settling.id]]);

    const stale = await store!.paymentStore.listStaleUnsettled(30);
    expect(stale.map(({ id }) => id).sort()).toEqual([authorized.id, settling.id].sort());
    expect(await store!.paymentStore.resolveStale(authorized.id)).toBe('abandoned');
    expect(await store!.paymentStore.getPaymentById(authorized.id)).toMatchObject({ status: 'failed', errorReason: 'abandoned_before_settlement' });
    expect(await store!.paymentStore.resolveStale(settling.id)).toBe('unknown');
    expect(await store!.paymentStore.getPaymentById(settling.id)).toMatchObject({ status: 'settlement_unknown', settlementError: 'stale_settling' });
  });
});
