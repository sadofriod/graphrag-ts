import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config.ts';
import type { Logger } from '../log.ts';
import type { IndexStore } from '../store.ts';
import { runSnapshotQuery, QueryServiceError } from '../queryService.ts';
import { createQueryLimiter } from '../mcp/tools.ts';
import { findDataset, type Dataset, type DatasetRegistry } from './datasets.ts';
import type { FacilitatorClient } from './facilitator.ts';
import { PaymentConflictError, PaymentReplayError, type PaymentRecord, type PaymentStore } from './payments.ts';
import { encodePaymentHeader, type PaymentPayload, type PaymentRequirements, type SettleResponse } from './types.ts';
import type { X402Settings } from './settings.ts';
import { buildChallenge, matchesRequirements, requirementsFor } from './challenge.ts';
import { corsHeaders, errorResponse, jsonResponse } from './http.ts';
import { nonceFromPayload, parsePaymentPayload, parseRequestBody, requestHash, validIdempotencyKey, type QueryInput } from './payload.ts';
import { paymentBody, responseSettlement, settledResponse } from './response.ts';

type PaidRouteDeps = {
  readonly store: IndexStore;
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly registry: DatasetRegistry;
  readonly payments: PaymentStore;
  readonly facilitator: FacilitatorClient;
  readonly limiter: ReturnType<typeof createQueryLimiter>;
  readonly settings: X402Settings;
  readonly now?: () => number;
  readonly runQuery?: typeof runSnapshotQuery;
};

const catalog = (registry: DatasetRegistry) => ({ datasets: registry.datasets.map((dataset) => ({
  id: dataset.id,
  workspace_id: dataset.workspaceId,
  title: dataset.title,
  description: dataset.description,
  synthetic: dataset.synthetic,
  license: dataset.license,
  tags: dataset.tags,
  pricing: {
    local: dataset.pricing.local,
    global: {
      upto: dataset.pricing.global.upto,
      base: dataset.pricing.global.base,
      per_map_answer: dataset.pricing.global.perMapAnswer,
    },
  },
})) });

const handleCatalogue = (request: Request, registry: DatasetRegistry): Response | undefined => {
  const path = new URL(request.url).pathname;
  if (path !== '/api/v1/datasets' && path !== '/api/v1/pricing') return undefined;
  if (request.method !== 'GET') return errorResponse(405, 'Method not allowed.');
  return jsonResponse(200, catalog(registry), { 'cache-control': 'public, max-age=60' });
};

const replayResponse = (record: PaymentRecord): Response => {
  if (record.status === 'settled' && record.responseBody !== null) {
    return jsonResponse(200, record.responseBody, { 'payment-response': encodePaymentHeader(responseSettlement(record)) });
  }
  if (record.status === 'failed') return errorResponse(402, record.errorReason ?? 'Payment failed.');
  return errorResponse(409, 'Payment request is still pending.');
};

const beginRequestPayment = async (
  deps: PaidRouteDeps,
  dataset: Dataset,
  input: QueryInput,
  requirements: PaymentRequirements,
  payload: PaymentPayload,
  requestId: string,
): Promise<{ record?: PaymentRecord; response?: Response }> => {
  try {
    const begun = await deps.payments.beginPayment({
      id: randomUUID(), requestId, requestHash: requestHash(input), nonce: nonceFromPayload(payload), datasetId: dataset.id,
      mode: input.mode, scheme: requirements.scheme as 'exact' | 'upto', network: requirements.network,
      asset: requirements.asset, amountAuthorized: requirements.amount,
    });
    if (begun.kind === 'replay') return { response: replayResponse(begun.record) };
    return { record: begun.record };
  } catch (error) {
    if (error instanceof PaymentReplayError || error instanceof PaymentConflictError) return { response: errorResponse(409, error.message) };
    deps.logger.error('Paid query payment ledger unavailable.', { dataset_id: dataset.id, mode: input.mode, result_code: 'ledger_error' });
    return { response: errorResponse(503, 'Payment service unavailable.') };
  }
};

const handleRetrievalFailure = async (
  error: unknown,
  fail: (reason: string, payer?: string) => Promise<void>,
  payer: string | undefined,
  release: () => void,
  markReleaseAfterCompletion: () => void,
): Promise<Response> => {
  const code = error instanceof QueryServiceError ? error.code : 'QUERY_FAILED';
  if (error instanceof QueryServiceError && error.completion) {
    markReleaseAfterCompletion();
    void error.completion.then(release);
  }
  const status = code === 'INDEX_NOT_READY' ? 503 : code === 'QUERY_TIMEOUT' ? 504 : 502;
  const message = code === 'INDEX_NOT_READY' ? 'No index is published yet.' : code === 'QUERY_TIMEOUT' ? 'The query timed out.' : 'GraphRAG retrieval failed.';
  await fail(code.toLowerCase(), payer);
  return errorResponse(status, message);
};

const retrieveAndSettle = async (
  deps: PaidRouteDeps,
  dataset: Dataset,
  input: QueryInput,
  requirements: PaymentRequirements,
  payload: PaymentPayload,
  record: PaymentRecord,
  requestId: string,
  payer: string | undefined,
  startedAt: number,
  release: () => void,
  markReleaseAfterCompletion: () => void,
): Promise<Response> => {
  let snapshot;
  try {
    snapshot = await (deps.runQuery ?? runSnapshotQuery)({ store: deps.store, config: deps.config, logger: deps.logger }, {
      workspaceId: dataset.workspaceId, query: input.query, mode: input.mode, maxResults: input.max_results,
    });
  } catch (error) {
    return handleRetrievalFailure(error, async (reason, fromPayer) => {
      await deps.payments.failPayment(record.id, { errorReason: reason, ...(fromPayer ? { payer: fromPayer } : {}) });
    }, payer, release, markReleaseAfterCompletion);
  }
  const mapAnswers = 'selectedMapAnswers' in snapshot.result ? snapshot.result.selectedMapAnswers.length : 0;
  const actualAmount = parsePaymentAmount(dataset, input.mode, mapAnswers);
  const settleRequirements: PaymentRequirements = { ...requirements, amount: actualAmount };
  let settlement: SettleResponse;
  try {
    settlement = await deps.facilitator.settle({ paymentPayload: payload, paymentRequirements: settleRequirements });
  } catch {
    await deps.payments.failPayment(record.id, { errorReason: 'settlement_unavailable', ...(payer ? { payer } : {}) });
    return errorResponse(502, 'Payment settlement failed.');
  }
  if (!settlement.success) {
    const reason = settlement.errorReason ?? 'Payment settlement failed.';
    const failedPayer = settlement.payer ?? payer;
    await deps.payments.failPayment(record.id, { errorReason: reason, ...(failedPayer ? { payer: failedPayer } : {}) });
    return errorResponse(402, reason, { 'payment-response': encodePaymentHeader(settlement) });
  }
  return completeSuccess(deps, dataset, input.mode, record, requestId, snapshot, actualAmount, settlement, payer, startedAt);
};

const parsePaymentAmount = (dataset: Dataset, mode: 'local' | 'global', mapAnswers: number): string => {
  if (mode === 'local') return dataset.pricing.local.atomic;
  const authorization = BigInt(dataset.pricing.global.upto.atomic);
  const computed = BigInt(dataset.pricing.global.base.atomic) + BigInt(dataset.pricing.global.perMapAnswer.atomic) * BigInt(mapAnswers);
  return (computed < authorization ? computed : authorization).toString();
};

const completeSuccess = async (
  deps: PaidRouteDeps,
  dataset: Dataset,
  mode: 'local' | 'global',
  record: PaymentRecord,
  requestId: string,
  snapshot: Awaited<ReturnType<typeof runSnapshotQuery>>,
  amount: string,
  settlement: SettleResponse,
  verifiedPayer: string | undefined,
  startedAt: number,
): Promise<Response> => {
  const settledAt = new Date((deps.now ?? Date.now)()).toISOString();
  const payer = settlement.payer ?? verifiedPayer ?? '';
  const body = paymentBody(dataset, mode, snapshot.result, snapshot.version, snapshot.durationMs, {
    payment_id: record.id, request_id: requestId, scheme: record.scheme, network: record.network,
    asset: record.asset, amount, payer, transaction: settlement.transaction, settled_at: settledAt,
  });
  const latency = Math.max(0, (deps.now ?? Date.now)() - startedAt);
  try {
    await deps.payments.completePayment(record.id, {
      payer, transaction: settlement.transaction, amountSettled: amount, responseBody: body,
      datasetVersion: snapshot.version.id, latencyMs: latency,
    });
  } catch {
    deps.logger.error('Paid query ledger write failed after settlement.', {
      dataset_id: dataset.id, mode, payment_id: record.id, transaction: settlement.transaction, result_code: 'ledger_write_failed',
    });
  }
  deps.logger.info('Paid query completed.', {
    dataset_id: dataset.id, mode, payment_id: record.id, amount,
    latency_ms: Math.max(0, (deps.now ?? Date.now)() - startedAt), result_code: 'success',
  });
  return settledResponse(body, { ...settlement, amount });
};

const performPaidQuery = async (
  deps: PaidRouteDeps,
  request: Request,
  dataset: Dataset,
  input: QueryInput,
  requirements: PaymentRequirements,
  payload: PaymentPayload,
  record: PaymentRecord,
  requestId: string,
): Promise<Response> => {
  const fail = (reason: string, payer?: string): Promise<void> => deps.payments.failPayment(record.id, { errorReason: reason, ...(payer ? { payer } : {}) });
  const release = deps.limiter.tryAcquire();
  if (!release) {
    await fail('capacity');
    return errorResponse(503, 'The server has reached its active query limit. Try again shortly.');
  }
  const startedAt = (deps.now ?? Date.now)();
  let releaseAfterCompletion = false;
  try {
    let verification;
    try {
      verification = await deps.facilitator.verify({ paymentPayload: payload, paymentRequirements: requirements });
    } catch {
      await fail('verification_unavailable');
      return errorResponse(502, 'Payment verification failed.');
    }
    if (!verification.isValid) {
      const reason = 'Payment is invalid.';
      await fail(reason, verification.payer);
      return buildChallenge(request, dataset, input.mode, requirements, deps.settings, verification.invalidReason ?? reason);
    }
    return await retrieveAndSettle(
      deps, dataset, input, requirements, payload, record, requestId, verification.payer, startedAt,
      release, () => { releaseAfterCompletion = true; },
    );
  } finally {
    if (!releaseAfterCompletion) release();
  }
};

const handlePaidQuery = async (request: Request, input: QueryInput, deps: PaidRouteDeps): Promise<Response> => {
  const dataset = findDataset(deps.registry, input.dataset_id);
  if (!dataset) return errorResponse(404, 'Unknown dataset.');
  const requirements = requirementsFor(dataset, input.mode, deps.settings);
  const signature = request.headers.get('PAYMENT-SIGNATURE');
  if (!signature) return buildChallenge(request, dataset, input.mode, requirements, deps.settings);
  const decoded = parsePaymentPayload(signature);
  if (!decoded.payload) return errorResponse(400, decoded.error ?? 'Payment payload is invalid.');
  const payload = decoded.payload;
  if (!matchesRequirements(payload.accepted, requirements)) return buildChallenge(request, dataset, input.mode, requirements, deps.settings, 'payment requirements do not match');
  const idempotencyKey = request.headers.get('Idempotency-Key');
  if (!validIdempotencyKey(idempotencyKey)) return errorResponse(400, 'Invalid Idempotency-Key.');
  const requestId = idempotencyKey ?? `nonce:${nonceFromPayload(payload)}`;
  const begun = await beginRequestPayment(deps, dataset, input, requirements, payload, requestId);
  if (begun.response) return begun.response;
  return performPaidQuery(deps, request, dataset, input, requirements, payload, begun.record as PaymentRecord, requestId);
};

export const createPaidQueryRoute = (deps: PaidRouteDeps) => async (request: Request): Promise<Response | undefined> => {
  const path = new URL(request.url).pathname;
  if (path.startsWith('/api/v1/') && request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: {
      ...corsHeaders,
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'PAYMENT-SIGNATURE,Content-Type,Idempotency-Key',
      'access-control-max-age': '600',
    } });
  }
  const catalogue = handleCatalogue(request, deps.registry);
  if (catalogue) return catalogue;
  if (path !== '/api/v1/query') return undefined;
  if (request.method !== 'POST') return errorResponse(405, 'Method not allowed.');
  const parsed = await parseRequestBody(request);
  return parsed.input ? handlePaidQuery(request, parsed.input, deps) : errorResponse(400, parsed.error ?? 'Invalid request body.');
};
