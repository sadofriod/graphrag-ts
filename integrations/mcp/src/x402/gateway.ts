import { createHash, randomUUID } from 'node:crypto';
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
import { corsHeaders, errorResponse, jsonResponse, publicUrlForPath } from './http.ts';
import { nonceFromPayload, parsePaymentPayload, parseRequestBody, requestHash, validIdempotencyKey, type QueryInput } from './payload.ts';
import { paymentBody, responseSettlement, settledResponse } from './response.ts';
import { bazaarDeclaration } from './bazaar.ts';

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
      scheme: dataset.pricing.global.scheme,
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

const handleDiscovery = (request: Request, deps: PaidRouteDeps): Response | undefined => {
  const path = new URL(request.url).pathname;
  if (path === '/.well-known/x402') return handleManifest(request, deps.settings);
  if (path !== '/api/v1/discovery') return undefined;
  if (request.method !== 'GET') return errorResponse(405, 'Method not allowed.');
  const items = deps.registry.datasets.map((dataset) => ({
    resource: publicUrlForPath(request, '/api/v1/query', deps.settings.publicBaseUrl),
    type: 'http',
    x402Version: 2,
    accepts: [requirementsFor(dataset, 'local', deps.settings)],
    extensions: { bazaar: bazaarDeclaration(dataset, 'local') },
  }));
  return jsonResponse(200, { x402Version: 2, items, pagination: { limit: 20, offset: 0, total: items.length } }, { 'cache-control': 'public, max-age=300' });
};

const handleManifest = (request: Request, settings: X402Settings): Response => {
  if (request.method !== 'GET') return errorResponse(405, 'Method not allowed.');
  return jsonResponse(200, {
    x402Version: 2,
    kind: 'resource-server',
    name: 'graphrag-ts',
    description: 'Paid GraphRAG queries over curated datasets.',
    resources: [{
      url: publicUrlForPath(request, '/api/v1/query', settings.publicBaseUrl),
      method: 'POST',
      description: 'Ask questions about a GraphRAG dataset.',
    }],
    docs: 'https://github.com/sadofriod/graphrag-ts',
    attestation: { type: 'none' },
  }, { 'cache-control': 'public, max-age=300' });
};

const replayResponse = (record: PaymentRecord): Response => {
  if (record.status === 'settled' && record.responseBody !== null) {
    return jsonResponse(200, record.responseBody, { 'payment-response': encodePaymentHeader(responseSettlement(record)) });
  }
  if (record.status === 'failed') return errorResponse(402, record.errorReason ?? 'Payment failed.');
  if (record.status === 'settlement_unknown') {
    return jsonResponse(409, { status: 'settlement_unknown', request_id: record.requestId, recovery: 'retry with the same PAYMENT-SIGNATURE' });
  }
  return jsonResponse(409, { status: 'in_progress' }, { 'retry-after': '2' });
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
  const pendingAnswer = paymentBody(dataset, input.mode, snapshot.result, snapshot.version, snapshot.durationMs, {
    payment_id: record.id, request_id: requestId, scheme: record.scheme, network: record.network,
    asset: record.asset, amount: actualAmount, payer: payer ?? '', transaction: '',
    settled_at: new Date((deps.now ?? Date.now)()).toISOString(),
  });
  await deps.payments.beginSettlement(record.id, pendingAnswer, settleRequirements);
  let settlement: SettleResponse;
  try {
    settlement = await deps.facilitator.settle({ paymentPayload: payload, paymentRequirements: settleRequirements });
  } catch (error) {
    await deps.payments.markSettlementUnknown(record.id, error instanceof Error ? error.message : 'Settlement transport failed.');
    return jsonResponse(409, { status: 'settlement_unknown', request_id: requestId, recovery: 'retry with the same PAYMENT-SIGNATURE' });
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
  if (dataset.pricing.global.scheme === 'exact') return dataset.pricing.global.upto.atomic;
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
  release: () => void,
  markReleased: () => void,
): Promise<Response> => {
  const startedAt = (deps.now ?? Date.now)();
  return retrieveAndSettle(
    deps, dataset, input, requirements, payload, record, requestId, record.payer ?? undefined, startedAt,
    release, markReleased,
  );
};

const handleRejectedPayment = async (
  request: Request,
  dataset: Dataset,
  input: QueryInput,
  payload: PaymentPayload,
  fingerprint: string,
  requirements: PaymentRequirements,
  deps: PaidRouteDeps,
  reason: string,
  payer: string | undefined,
): Promise<Response> => {
  try {
    await deps.payments.recordRejectedAttempt({
      id: randomUUID(), datasetId: dataset.id, mode: input.mode, nonce: nonceFromPayload(payload),
      payloadHash: fingerprint, ...(payer ? { payer } : {}), reason,
    });
  } catch {
    deps.logger.error('Rejected payment audit write failed.', { dataset_id: dataset.id, mode: input.mode, result_code: 'audit_write_failed' });
  }
  return buildChallenge(request, dataset, input.mode, requirements, deps.settings, reason);
};

const replayResponseForRequest = async (
  deps: PaidRouteDeps,
  dataset: Dataset,
  input: QueryInput,
  fingerprint: string,
  bodyHash: string,
): Promise<Response | undefined> => {
  try {
    const replay = await deps.payments.getPaymentByFingerprint(fingerprint);
    if (!replay) return undefined;
    if (replay.requestHash !== bodyHash) {
      return errorResponse(409, 'This payment signature was already used for a different request.');
    }
    return replayResponse(replay);
  } catch {
    deps.logger.error('Paid query payment ledger unavailable.', { dataset_id: dataset.id, mode: input.mode, result_code: 'ledger_error' });
    return errorResponse(503, 'Payment service unavailable.');
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
  const fingerprint = createHash('sha256').update(signature).digest('hex');
  const bodyHash = requestHash(input);
  const replay = await replayResponseForRequest(deps, dataset, input, fingerprint, bodyHash);
  if (replay) return replay;
  if (!matchesRequirements(payload.accepted, requirements)) return buildChallenge(request, dataset, input.mode, requirements, deps.settings, 'payment requirements do not match');
  const idempotencyKey = request.headers.get('Idempotency-Key');
  if (!validIdempotencyKey(idempotencyKey)) return errorResponse(400, 'Invalid Idempotency-Key.');
  const requestId = idempotencyKey ?? `nonce:${nonceFromPayload(payload)}`;
  // Capacity is checked before authentication so a saturated server neither verifies
  // payments nor claims an idempotency key or nonce it will not honour.
  const release = deps.limiter.tryAcquire();
  if (!release) {
    return errorResponse(503, 'The server has reached its active query limit. Try again shortly.');
  }
  let releaseAfterCompletion = false;
  try {
    return await authenticatedPaidQuery(
      deps, request, dataset, input, requirements, payload, fingerprint, bodyHash, requestId, release,
      () => { releaseAfterCompletion = true; },
    );
  } finally {
    if (!releaseAfterCompletion) release();
  }
};

const authenticatedPaidQuery = async (
  deps: PaidRouteDeps,
  request: Request,
  dataset: Dataset,
  input: QueryInput,
  requirements: PaymentRequirements,
  payload: PaymentPayload,
  fingerprint: string,
  bodyHash: string,
  requestId: string,
  release: () => void,
  markReleased: () => void,
): Promise<Response> => {
  let verification;
  try {
    verification = await deps.facilitator.verify({ paymentPayload: payload, paymentRequirements: requirements });
  } catch {
    return errorResponse(502, 'Payment verification failed.');
  }
  if (!verification.isValid) {
    const reason = verification.invalidReason ?? 'Payment is invalid.';
    return handleRejectedPayment(request, dataset, input, payload, fingerprint, requirements, deps, reason, verification.payer);
  }
  let begun: Awaited<ReturnType<PaymentStore['beginPayment']>>;
  try {
    begun = await deps.payments.beginPayment({
      id: randomUUID(), requestId, requestHash: bodyHash, nonce: nonceFromPayload(payload), datasetId: dataset.id,
      workspaceId: dataset.workspaceId, mode: input.mode, scheme: requirements.scheme as 'exact' | 'upto',
      network: requirements.network, asset: requirements.asset, amountAuthorized: requirements.amount,
      payloadFingerprint: fingerprint, payload, requirements, payer: verification.payer ?? '',
    });
  } catch (error) {
    if (error instanceof PaymentReplayError || error instanceof PaymentConflictError) return errorResponse(409, error.message);
    deps.logger.error('Paid query payment ledger unavailable.', { dataset_id: dataset.id, mode: input.mode, result_code: 'ledger_error' });
    return errorResponse(503, 'Payment service unavailable.');
  }
  if (begun.kind === 'replay') {
    if (begun.record.requestHash !== bodyHash) {
      return errorResponse(409, 'This payment signature was already used for a different request.');
    }
    return replayResponse(begun.record);
  }
  return performPaidQuery(
    deps, request, dataset, input, requirements, payload, begun.record, requestId, release, markReleased,
  );
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
  const discovery = handleDiscovery(request, deps);
  if (discovery) return discovery;
  if (path !== '/api/v1/query') return undefined;
  if (request.method !== 'POST') return errorResponse(405, 'Method not allowed.');
  const parsed = await parseRequestBody(request);
  return parsed.input ? handlePaidQuery(request, parsed.input, deps) : errorResponse(400, parsed.error ?? 'Invalid request body.');
};
