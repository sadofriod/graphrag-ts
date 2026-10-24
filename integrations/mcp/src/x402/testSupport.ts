import { describe, expect, test } from 'bun:test';
import { loadConfig } from '../config.ts';
import { createLogger } from '../log.ts';
import type { IndexStore } from '../store.ts';
import { QueryServiceError, type runSnapshotQuery } from '../queryService.ts';
import type { DatasetRegistry } from './datasets.ts';
import { createPaidQueryRoute } from './gateway.ts';
import type { FacilitatorClient } from './facilitator.ts';
import { PaymentConflictError, PaymentReplayError, type PaymentRecord, type PaymentStore } from './payments.ts';
import { encodePaymentHeader, type PaymentPayload, type PaymentRequirements } from './types.ts';
import type { X402Settings } from './settings.ts';

export { describe, expect, test };

export const settings: X402Settings = {
  facilitatorUrl: 'https://facilitator.invalid', network: 'eip155:84532', asset: '0xasset', assetName: 'USDC',
  assetVersion: '2', payTo: '0xreceiver', maxTimeoutSeconds: 60, publicBaseUrl: 'https://api.example.test/',
  uptoFacilitatorAddress: '0x68EFaFE862d89cE66dd3D7B07d5A3747A0871164',
};

export const registry: DatasetRegistry = { datasets: [{
  id: 'demo', workspaceId: 'workspace-demo', title: 'Demo dataset', description: 'Synthetic demo.', synthetic: true,
  license: { spdx: 'MIT', url: 'https://example.test/license' }, tags: ['demo'],
  pricing: {
    local: { usd: '$0.02', atomic: '20000' },
    global: { scheme: 'upto', upto: { usd: '$0.10', atomic: '100000' }, base: { usd: '$0.02', atomic: '20000' }, perMapAnswer: { usd: '$0.01', atomic: '10000' } },
  },
}] };

const config = loadConfig({ DATABASE_URL: 'postgresql://localhost/unused', QUERY_TIMEOUT_MS: '1000' });
const logger = createLogger('error');

const recordBase = (input: Parameters<PaymentStore['beginPayment']>[0]): PaymentRecord => ({
  id: input.id, requestId: input.requestId, requestHash: input.requestHash, nonce: input.nonce, datasetId: input.datasetId,
  mode: input.mode, scheme: input.scheme, network: input.network, asset: input.asset, amountAuthorized: input.amountAuthorized,
  amountSettled: null, payer: null, status: 'authorized', transaction: null, errorReason: null, settlementError: null, settleAttempts: 0,
  responseBody: null, answerBody: null, payloadFingerprint: null, payload: null, requirements: null, workspaceId: 'workspace-demo',
  datasetVersion: null, latencyMs: null, createdAt: new Date(0), updatedAt: new Date(0), settledAt: null,
});

export type SetupOptions = {
  readonly valid?: boolean;
  readonly result?: 'local' | 'global' | 'failure' | 'timeout';
  readonly capacity?: boolean;
  readonly completePaymentFails?: boolean;
  readonly globalScheme?: 'upto' | 'exact';
  readonly settlementThrows?: boolean;
};

type LedgerState = {
  readonly records: Map<string, PaymentRecord>;
  readonly nonceRequests: Map<string, string>;
  readonly fingerprints: Map<string, string>;
  readonly rejected: unknown[];
};

const findById = (state: LedgerState, id: string): PaymentRecord | undefined =>
  [...state.records.values()].find((item) => item.id === id);

const replaceRecord = (state: LedgerState, next: PaymentRecord): void => {
  state.records.set(next.requestId, next);
};

const createLedger = (state: LedgerState, options: SetupOptions): PaymentStore => ({
  beginPayment: async (input: Parameters<PaymentStore['beginPayment']>[0]) => {
    const fingerprintId = state.fingerprints.get(input.payloadFingerprint);
    if (fingerprintId) {
      const replay = findById(state, fingerprintId);
      if (replay) return { kind: 'replay' as const, record: replay };
    }
    if (state.records.has(input.requestId)) throw new PaymentConflictError();
    if (state.nonceRequests.has(input.nonce)) throw new PaymentReplayError();
    const record = {
      ...recordBase(input), workspaceId: input.workspaceId, payloadFingerprint: input.payloadFingerprint,
      payload: input.payload, requirements: input.requirements, payer: input.payer,
    };
    state.records.set(input.requestId, record);
    state.nonceRequests.set(input.nonce, input.requestId);
    state.fingerprints.set(input.payloadFingerprint, record.id);
    return { kind: 'new' as const, record };
  },
  getPaymentByFingerprint: async (fingerprint: string) => {
    const id = state.fingerprints.get(fingerprint);
    return id ? findById(state, id) : undefined;
  },
  recordRejectedAttempt: async (attempt: unknown) => { state.rejected.push(attempt); },
  beginSettlement: async (id: string, answer: unknown) => {
    const found = findById(state, id);
    if (found) replaceRecord(state, { ...found, status: 'settling', answerBody: answer });
  },
  markSettlementUnknown: async (id: string, message: string) => {
    const found = findById(state, id);
    if (found) {
      replaceRecord(state, {
        ...found, status: 'settlement_unknown', settlementError: message, settleAttempts: found.settleAttempts + 1,
      });
    }
  },
  completePayment: async (id: string, input: Parameters<PaymentStore['completePayment']>[1]) => {
    if (options.completePaymentFails) throw new Error('ledger unavailable');
    const found = findById(state, id);
    if (!found) throw new Error('missing');
    const completed = {
      ...found, status: 'settled' as const, amountSettled: input.amountSettled, payer: input.payer,
      transaction: input.transaction, responseBody: input.responseBody, datasetVersion: input.datasetVersion,
      latencyMs: input.latencyMs, settledAt: new Date(0),
    };
    replaceRecord(state, completed);
    return completed;
  },
  failPayment: async (id: string, input: { errorReason: string; payer?: string }) => {
    const found = findById(state, id);
    if (found) replaceRecord(state, { ...found, status: 'failed', errorReason: input.errorReason });
  },
  resolveStale: async (id: string) => {
    const found = findById(state, id);
    if (!found) return 'skipped' as const;
    if (found.status === 'authorized') {
      replaceRecord(state, { ...found, status: 'failed', errorReason: 'abandoned_before_settlement' });
      return 'abandoned' as const;
    }
    if (found.status === 'settling') {
      replaceRecord(state, { ...found, status: 'settlement_unknown', settlementError: 'stale_settling' });
      return 'unknown' as const;
    }
    return 'skipped' as const;
  },
  getPaymentById: async () => undefined,
  metrics: async () => ({ settledCount: 0, failedCount: 0, unsettledCount: 0, settledAmount: '0' }),
} as unknown as PaymentStore);

type FacilitationState = {
  verifyCalls: number;
  settleCalls: number;
  readonly settledAmounts: string[];
  failNextSettlement: boolean;
  valid: boolean;
};

const createFacilitationState = (options: SetupOptions): FacilitationState => ({
  verifyCalls: 0, settleCalls: 0, settledAmounts: [], failNextSettlement: false, valid: options.valid !== false,
});

const createFacilitator = (state: FacilitationState, options: SetupOptions): FacilitatorClient => ({
  verify: async () => {
    state.verifyCalls += 1;
    return state.valid
      ? { isValid: true, payer: '0xbuyer' }
      : { isValid: false, invalidReason: 'invalid payment', payer: '0xbuyer' };
  },
  settle: async ({ paymentRequirements }: { paymentRequirements: PaymentRequirements }) => {
    state.settleCalls += 1;
    state.settledAmounts.push(paymentRequirements.amount);
    if (options.settlementThrows) throw new Error('transport timeout');
    if (state.failNextSettlement) {
      return { success: false, transaction: '', network: settings.network, errorReason: 'settlement rejected' };
    }
    return { success: true, transaction: '0xtx', network: settings.network, payer: '0xbuyer' };
  },
} as unknown as FacilitatorClient);

const leasedStore = {
  acquireActiveVersionLease: async () => ({ id: 'version-1', workspaceId: 'workspace-demo', namespace: 'snapshot', leaseId: 'lease-1' }),
  renewQueryLease: async () => undefined,
  releaseQueryLease: async () => undefined,
  appendActivityLog: async () => undefined,
} as unknown as IndexStore;

const createTimer = () => {
  const state = { verifyCalls: 0, settleCalls: 0, settledAmounts: [] as string[], failNextSettlement: false, executions: 0 };
  return state;
};

const createSigner = (currentRegistry: () => DatasetRegistry) => (
  mode: 'local' | 'global' = 'local',
  nonce = 'nonce-0001',
  overrides: Partial<PaymentRequirements> = {},
): string => {
  const accepted: PaymentRequirements = {
    scheme: mode === 'local' ? 'exact' : currentRegistry().datasets[0]?.pricing.global.scheme ?? 'upto',
    network: settings.network,
    amount: mode === 'local' ? '20000' : '100000', asset: settings.asset, payTo: settings.payTo,
    maxTimeoutSeconds: 60, extra: { name: 'USDC', version: '2' }, ...overrides,
  };
  if (mode === 'global' && accepted.scheme === 'upto') {
    accepted.extra = { name: 'USDC', version: '2', paymentFlow: 'authorization' };
  }
  const payload: PaymentPayload = { x402Version: 2, accepted, payload: { authorization: { nonce } } };
  return encodePaymentHeader(payload);
};

export const setup = (options: SetupOptions = {}) => {
  let testRegistry: DatasetRegistry = options.globalScheme
    ? { datasets: registry.datasets.map((dataset) => ({
        ...dataset,
        pricing: { ...dataset.pricing, global: { ...dataset.pricing.global, scheme: options.globalScheme! } },
      })) }
    : registry;
  const ledgerState: LedgerState = {
    records: new Map<string, PaymentRecord>(), nonceRequests: new Map<string, string>(),
    fingerprints: new Map<string, string>(), rejected: [],
  };
  const counters = createTimer();
  const facilitation = createFacilitationState(options);
  const facilitator = createFacilitator(facilitation, options);
  const payments = createLedger(ledgerState, options);
  let releaseSlot: (() => void) | undefined;
  const limiter = options.capacity
    ? { tryAcquire: () => undefined }
    : { tryAcquire: () => { releaseSlot = () => undefined; return releaseSlot; } };
  const runQuery = (async () => {
    counters.executions += 1;
    if (options.result === 'failure') throw new Error('private retrieval message');
    if (options.result === 'timeout') throw new QueryServiceError('QUERY_TIMEOUT', 'timeout');
    const result = options.result === 'global'
      ? { answer: 'global answer', selectedMapAnswers: [
          { answer: 'map a', communityIds: ['c1'], usefulness: 0.8 }, { answer: 'map b', communityIds: ['c2'], usefulness: 0.7 },
        ] }
      : { answer: 'local answer', evidence: [{ text: 'evidence', sourceDocumentId: 'source.md' }] };
    return { result, version: { id: 'version-1', workspaceId: 'workspace-demo' }, durationMs: 12, leaseId: 'lease-1' };
  }) as unknown as typeof runSnapshotQuery;
  const route = createPaidQueryRoute({
    store: leasedStore, config, logger, registry: testRegistry, payments, facilitator, limiter, settings,
    now: () => 1_700_000_000_000, runQuery,
  });
  const sign = createSigner(() => testRegistry);
  const request = (
    body: unknown = { dataset_id: 'demo', query: 'test' },
    signature = sign(),
    extraHeaders: Record<string, string> = {},
  ) => route(new Request('https://internal.test/api/v1/query', {
    method: 'POST',
    headers: { host: 'internal.test', 'content-type': 'application/json', 'PAYMENT-SIGNATURE': signature, ...extraHeaders },
    body: JSON.stringify(body),
  }));
  return {
    route, request, sign, records: ledgerState.records, payments, rejected: ledgerState.rejected,
    get verifyCalls() { return facilitation.verifyCalls; },
    get settleCalls() { return facilitation.settleCalls; },
    get settledAmounts() { return facilitation.settledAmounts; },
    get executions() { return counters.executions; },
    get releaseSlot() { return releaseSlot; },
    get failNextSettlement() { return facilitation.failNextSettlement; },
    set failNextSettlement(value: boolean) { facilitation.failNextSettlement = value; },
    set valid(value: boolean) { facilitation.valid = value; },
    changePrice() {
      testRegistry = { datasets: testRegistry.datasets.map((dataset) => ({
        ...dataset, pricing: { ...dataset.pricing, local: { usd: '$0.50', atomic: '500000' } },
      })) };
    },
  };
};
