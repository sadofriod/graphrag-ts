import { createHash, randomUUID } from 'node:crypto';
import { QueryServiceError, runSnapshotQuery } from '../queryService.ts';
import type { Dataset } from './datasets.ts';
import { findDataset } from './datasets.ts';
import { buildChallenge, matchesRequirements, requirementsFor } from './challenge.ts';
import { errorResponse, jsonResponse } from './http.ts';
import { nonceFromPayload, parsePaymentPayload, requestHash, validIdempotencyKey, type QueryInput } from './payload.ts';
import { paymentBody, responseSettlement, settledResponse } from './response.ts';
import { settleAmountFor } from './pricing.ts';
import { encodePaymentHeader, type PaymentPayload, type PaymentRequirements, type SettleResponse } from './types.ts';
import { PaymentConflictError, PaymentReplayError, type PaymentRecord } from './payments.ts';
import type { PaidRouteDeps } from './routeTypes.ts';
import { withQuerySlot, type QuerySlot } from './slot.ts';

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
  slot: QuerySlot,
): Promise<Response> => {
  const code = error instanceof QueryServiceError ? error.code : 'QUERY_FAILED';
  if (error instanceof QueryServiceError && error.completion) slot.releaseAfter(error.completion);
  const status = code === 'INDEX_NOT_READY' ? 503 : code === 'QUERY_TIMEOUT' ? 504 : 502;
  const message = code === 'INDEX_NOT_READY' ? 'No index is published yet.' : code === 'QUERY_TIMEOUT' ? 'The query timed out.' : 'GraphRAG retrieval failed.';
  await fail(code.toLowerCase(), payer);
  return errorResponse(status, message);
};

type QuerySnapshot = Awaited<ReturnType<typeof runSnapshotQuery>>;

const canonicalPayer = (payer: string | undefined, fallback?: string): string | undefined => {
  const value = payer?.trim() || fallback;
  return value?.toLowerCase();
};

const settleRetrievedAnswer = async (
  deps: PaidRouteDeps,
  dataset: Dataset,
  mode: QueryInput['mode'],
  requirements: PaymentRequirements,
  payload: PaymentPayload,
  record: PaymentRecord,
  requestId: string,
  payer: string | undefined,
  startedAt: number,
  snapshot: QuerySnapshot,
): Promise<Response> => {
  const mapAnswers = 'selectedMapAnswers' in snapshot.result ? snapshot.result.selectedMapAnswers.length : 0;
  const actualAmount = settleAmountFor(dataset, mode, mapAnswers);
  const settleRequirements: PaymentRequirements = { ...requirements, amount: actualAmount };
  const pendingAnswer = paymentBody(dataset, mode, snapshot.result, snapshot.version, snapshot.durationMs, {
    payment_id: record.id, request_id: requestId, scheme: record.scheme, network: record.network,
    asset: record.asset, amount: actualAmount, payer: payer ?? '', transaction: '',
    settled_at: new Date((deps.now ?? Date.now)()).toISOString(),
  });
  const claimed = await deps.payments.beginSettlement(record.id, pendingAnswer, settleRequirements);
  if (!claimed) return jsonResponse(409, { status: 'payment_not_claimed', request_id: requestId });
  let settlement: SettleResponse;
  try {
    settlement = await deps.facilitator.settle({ paymentPayload: payload, paymentRequirements: settleRequirements });
  } catch (error) {
    await deps.payments.markSettlementUnknown(record.id, error instanceof Error ? error.message : 'Settlement transport failed.');
    return jsonResponse(409, { status: 'settlement_unknown', request_id: requestId, recovery: 'retry with the same PAYMENT-SIGNATURE' });
  }
  if (!settlement.success) {
    const reason = settlement.errorReason ?? 'Payment settlement failed.';
    const failedPayer = canonicalPayer(settlement.payer, payer);
    await deps.payments.failPayment(record.id, { errorReason: reason, ...(failedPayer ? { payer: failedPayer } : {}) });
    return errorResponse(402, reason, { 'payment-response': encodePaymentHeader(settlement) });
  }
  return completeSuccess(deps, dataset, mode, record, requestId, snapshot, actualAmount, settlement, payer, startedAt);
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
  slot: QuerySlot,
): Promise<Response> => {
  let snapshot;
  try {
    snapshot = await (deps.runQuery ?? runSnapshotQuery)({ store: deps.store, config: deps.config, logger: deps.logger }, {
      workspaceId: dataset.workspaceId, query: input.query, mode: input.mode, maxResults: input.max_results,
    });
  } catch (error) {
    return handleRetrievalFailure(error, async (reason, fromPayer) => {
      await deps.payments.failPayment(record.id, { errorReason: reason, ...(fromPayer ? { payer: fromPayer } : {}) });
    }, payer, slot);
  }
  return settleRetrievedAnswer(deps, dataset, input.mode, requirements, payload, record, requestId, payer, startedAt, snapshot);
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
  const payer = canonicalPayer(settlement.payer, verifiedPayer) ?? '';
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

export const handlePaidQuery = async (request: Request, input: QueryInput, deps: PaidRouteDeps): Promise<Response> => {
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
  const requestId = idempotencyKey ?? `payment:${fingerprint}`;
  return withQuerySlot(
    deps.limiter,
    () => errorResponse(503, 'The server has reached its active query limit. Try again shortly.'),
    (slot) => authenticatedPaidQuery(deps, request, dataset, input, requirements, payload, fingerprint, bodyHash, requestId, slot),
  );
};

type PaymentVerification =
  | { readonly kind: 'valid'; readonly payer: string }
  | { readonly kind: 'invalid'; readonly reason: string; readonly payer?: string }
  | { readonly kind: 'error' };

const verifyPaymentPayer = async (
  deps: PaidRouteDeps,
  payload: PaymentPayload,
  requirements: PaymentRequirements,
): Promise<PaymentVerification> => {
  let verification;
  try {
    verification = await deps.facilitator.verify({ paymentPayload: payload, paymentRequirements: requirements });
  } catch {
    return { kind: 'error' };
  }
  if (!verification.isValid) {
    return { kind: 'invalid', reason: verification.invalidReason ?? 'Payment is invalid.', ...(verification.payer ? { payer: verification.payer } : {}) };
  }
  const claimedPayer = payload.payload.authorization?.from ?? payload.payload.permit2Authorization?.from;
  const payer = verification.payer ?? (typeof claimedPayer === 'string' ? claimedPayer : undefined);
  return payer?.trim() ? { kind: 'valid', payer: payer.trim().toLowerCase() } : { kind: 'error' };
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
  slot: QuerySlot,
): Promise<Response> => {
  const verification = await verifyPaymentPayer(deps, payload, requirements);
  if (verification.kind === 'error') {
    return errorResponse(502, 'Payment verification failed.');
  }
  if (verification.kind === 'invalid') {
    return handleRejectedPayment(request, dataset, input, payload, fingerprint, requirements, deps, verification.reason, verification.payer);
  }
  const payer = verification.payer;
  let begun: Awaited<ReturnType<typeof deps.payments.beginPayment>>;
  try {
    begun = await deps.payments.beginPayment({
      id: randomUUID(), requestId, requestHash: bodyHash, nonce: nonceFromPayload(payload), datasetId: dataset.id,
      workspaceId: dataset.workspaceId, mode: input.mode, scheme: requirements.scheme as 'exact' | 'upto',
      network: requirements.network, asset: requirements.asset, amountAuthorized: requirements.amount,
      payloadFingerprint: fingerprint, payload, requirements, payer,
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
  const startedAt = (deps.now ?? Date.now)();
  return retrieveAndSettle(deps, dataset, input, requirements, payload, begun.record, requestId, begun.record.payer ?? undefined, startedAt, slot);
};
