import { createHash, randomUUID } from 'node:crypto';
import type { JudgmentDataset } from './datasets.ts';
import { findDataset, isJudgmentDataset } from './datasets.ts';
import { buildJudgmentChallenge, matchesRequirements } from './challenge.ts';
import { judgmentRequirements } from './pricing.ts';
import { errorResponse, jsonResponse } from './http.ts';
import { judgmentRequestHash, nonceFromPayload, parsePaymentPayload, validIdempotencyKey, type JudgmentInput } from './payload.ts';
import { encodePaymentHeader, type PaymentPayload, type PaymentRequirements, type SettleResponse } from './types.ts';
import { PaymentConflictError, PaymentReplayError, type PaymentRecord } from './payments.ts';
import type { PaidRouteDeps } from './routeTypes.ts';
import { withQuerySlot } from './slot.ts';

const replayResponse = (record: PaymentRecord): Response => {
  if (record.status === 'settled' && record.responseBody !== null) {
    const body = record.responseBody as { payment?: { transaction?: string; payer?: string; amount?: string } };
    return jsonResponse(200, record.responseBody, { 'payment-response': encodePaymentHeader({
      success: true, transaction: body.payment?.transaction ?? '', network: record.network,
      ...(body.payment?.payer ? { payer: body.payment.payer } : {}), ...(body.payment?.amount ? { amount: body.payment.amount } : {}),
    }) });
  }
  if (record.status === 'failed') return errorResponse(402, record.errorReason ?? 'Payment failed.');
  if (record.status === 'settlement_unknown') return unknownSettlement(record.requestId);
  return jsonResponse(409, { status: 'in_progress' }, { 'retry-after': '2' });
};

const unknownSettlement = (requestId: string): Response => jsonResponse(409, {
  status: 'settlement_unknown', request_id: requestId, recovery: 'retry with the same PAYMENT-SIGNATURE',
});

const canonicalPayer = (payer: string | undefined, fallback?: string): string | undefined => (payer?.trim() || fallback)?.toLowerCase();

const invokeJudge = (dataset: JudgmentDataset, deps: PaidRouteDeps, input: JudgmentInput) => {
  const ref = { ...(input.doi === undefined ? {} : { doi: input.doi }), ...(input.paper_id === undefined ? {} : { paper_id: input.paper_id }) };
  return dataset.tool === 'evidence_audit' ? deps.judge.evidenceAudit(ref) : deps.judge.retractionPropagation(ref);
};

const replayByFingerprint = async (deps: PaidRouteDeps, dataset: JudgmentDataset, fingerprint: string, bodyHash: string): Promise<Response | undefined> => {
  try {
    const record = await deps.payments.getPaymentByFingerprint(fingerprint);
    if (!record) return undefined;
    if (record.requestHash !== bodyHash) return errorResponse(409, 'This payment signature was already used for a different request.');
    return replayResponse(record);
  } catch {
    deps.logger.error('Judgment payment ledger unavailable.', { dataset_id: dataset.id, result_code: 'ledger_error' });
    return errorResponse(503, 'Payment service unavailable.');
  }
};

type Verification = { readonly payer: string } | { readonly invalid: string; readonly payer?: string } | undefined;

const verifyPayment = async (deps: PaidRouteDeps, payload: PaymentPayload, requirements: PaymentRequirements): Promise<Verification> => {
  try {
    const result = await deps.facilitator.verify({ paymentPayload: payload, paymentRequirements: requirements });
    if (!result.isValid) return { invalid: result.invalidReason ?? 'Payment is invalid.', ...(result.payer ? { payer: result.payer } : {}) };
    const claimed = payload.payload.authorization?.from ?? payload.payload.permit2Authorization?.from;
    const payer = result.payer ?? (typeof claimed === 'string' ? claimed : undefined);
    return payer?.trim() ? { payer: payer.trim().toLowerCase() } : undefined;
  } catch { return undefined; }
};

const registerPayment = async (
  deps: PaidRouteDeps, dataset: JudgmentDataset, input: JudgmentInput, payload: PaymentPayload,
  requirements: PaymentRequirements, fingerprint: string, bodyHash: string, requestId: string, payer: string,
): Promise<PaymentRecord | Response> => {
  try {
    const begun = await deps.payments.beginPayment({
      id: randomUUID(), requestId, requestHash: bodyHash, nonce: nonceFromPayload(payload), datasetId: dataset.id,
      workspaceId: 'judgment', mode: 'local', scheme: 'exact', network: requirements.network, asset: requirements.asset,
      amountAuthorized: requirements.amount, payloadFingerprint: fingerprint, payload, requirements, payer,
    });
    if (begun.kind === 'replay') return begun.record.requestHash === bodyHash ? replayResponse(begun.record)
      : errorResponse(409, 'This payment signature was already used for a different request.');
    return begun.record;
  } catch (error) {
    if (error instanceof PaymentReplayError || error instanceof PaymentConflictError) return errorResponse(409, error.message);
    deps.logger.error('Judgment payment ledger unavailable.', { dataset_id: dataset.id, result_code: 'ledger_error' });
    return errorResponse(503, 'Payment service unavailable.');
  }
};

const runAndSettle = async (
  deps: PaidRouteDeps, dataset: JudgmentDataset, input: JudgmentInput, payload: PaymentPayload,
  requirements: PaymentRequirements, record: PaymentRecord, requestId: string, payer: string,
): Promise<Response> => {
  const started = performance.now();
  let judgment;
  try { judgment = await invokeJudge(dataset, deps, input); } catch (error) {
    const noSnapshot = error instanceof Error && error.message.includes('No active integrity snapshot');
    await deps.payments.failPayment(record.id, { errorReason: noSnapshot ? 'no_snapshot' : 'judge_failed', payer });
    return errorResponse(noSnapshot ? 503 : 502, noSnapshot ? 'NO_SNAPSHOT' : 'JUDGE_FAILED');
  }
  const judgeMs = Math.max(0, performance.now() - started);
  return settleJudgment(deps, dataset, payload, requirements, record, requestId, payer, judgment, judgeMs);
};

const settleJudgment = async (
  deps: PaidRouteDeps, dataset: JudgmentDataset, payload: PaymentPayload, requirements: PaymentRequirements,
  record: PaymentRecord, requestId: string, payer: string, judgment: unknown, judgeMs: number,
): Promise<Response> => {
  const settledAt = new Date((deps.now ?? Date.now)()).toISOString();
  const body = { dataset: { id: dataset.id, tool: dataset.tool }, judgment, usage: { judge_ms: judgeMs }, payment: {
    payment_id: record.id, request_id: requestId, scheme: record.scheme, network: record.network,
    asset: record.asset, amount: requirements.amount, payer, transaction: '', settled_at: settledAt,
  } };
  if (!await deps.payments.beginSettlement(record.id, body, requirements)) return jsonResponse(409, { status: 'payment_not_claimed', request_id: requestId });
  let settlement: SettleResponse;
  try { settlement = await deps.facilitator.settle({ paymentPayload: payload, paymentRequirements: requirements }); } catch (error) {
    await deps.payments.markSettlementUnknown(record.id, error instanceof Error ? error.message : 'Settlement transport failed.');
    return unknownSettlement(requestId);
  }
  if (!settlement.success) {
    const failedPayer = canonicalPayer(settlement.payer, payer);
    await deps.payments.failPayment(record.id, { errorReason: settlement.errorReason ?? 'Payment settlement failed.', ...(failedPayer ? { payer: failedPayer } : {}) });
    return errorResponse(402, settlement.errorReason ?? 'Payment settlement failed.', { 'payment-response': encodePaymentHeader(settlement) });
  }
  return completeJudgment(deps, dataset, record, body, settlement, requirements.amount, payer);
};

const completeJudgment = async (
  deps: PaidRouteDeps, dataset: JudgmentDataset, record: PaymentRecord, initial: JudgmentResponseBody,
  settlement: SettleResponse, amount: string, payer: string,
): Promise<Response> => {
  const settledAt = new Date((deps.now ?? Date.now)()).toISOString();
  const body = { ...initial, payment: { ...initial.payment, payer: canonicalPayer(settlement.payer, payer) ?? '', transaction: settlement.transaction, settled_at: settledAt } };
  try {
    await deps.payments.completePayment(record.id, {
      payer: body.payment.payer, transaction: settlement.transaction, amountSettled: amount,
      responseBody: body, datasetVersion: (body.judgment as { snapshot?: { id?: string } })?.snapshot?.id ?? 'judgment',
      latencyMs: Math.max(0, Number(body.usage.judge_ms)),
    });
  } catch { deps.logger.error('Judgment payment ledger write failed after settlement.', { dataset_id: dataset.id, payment_id: record.id, result_code: 'ledger_write_failed' }); }
  return jsonResponse(200, body, { 'payment-response': encodePaymentHeader({ ...settlement, amount }) });
};

type JudgmentResponseBody = {
  readonly dataset: { readonly id: string; readonly tool: string }; readonly judgment: unknown; readonly usage: { readonly judge_ms: number };
  readonly payment: { readonly payment_id: string; readonly request_id: string; readonly scheme: string; readonly network: string; readonly asset: string; readonly amount: string; readonly payer: string; readonly transaction: string; readonly settled_at: string };
};

export const handlePaidJudgment = async (request: Request, input: JudgmentInput, deps: PaidRouteDeps): Promise<Response> => {
  const dataset = findDataset(deps.registry, input.dataset_id);
  if (!dataset || !isJudgmentDataset(dataset)) return errorResponse(404, 'Unknown judgment dataset.');
  const requirements = judgmentRequirements(dataset, deps.settings);
  const signature = request.headers.get('PAYMENT-SIGNATURE');
  if (!signature) return buildJudgmentChallenge(request, dataset, requirements, deps.settings);
  const decoded = parsePaymentPayload(signature);
  if (!decoded.payload) return errorResponse(400, decoded.error ?? 'Payment payload is invalid.');
  const payload = decoded.payload;
  const fingerprint = createHash('sha256').update(signature).digest('hex');
  const bodyHash = judgmentRequestHash(input);
  const replay = await replayByFingerprint(deps, dataset, fingerprint, bodyHash);
  if (replay) return replay;
  if (!matchesRequirements(payload.accepted, requirements)) return buildJudgmentChallenge(request, dataset, requirements, deps.settings, 'payment requirements do not match');
  const key = request.headers.get('Idempotency-Key');
  if (!validIdempotencyKey(key)) return errorResponse(400, 'Invalid Idempotency-Key.');
  const requestId = key ?? `payment:${fingerprint}`;
  return withQuerySlot(deps.limiter, () => errorResponse(503, 'The server has reached its active query limit. Try again shortly.'),
    async () => executePaidJudgment(request, deps, dataset, input, payload, requirements, fingerprint, bodyHash, requestId));
};

const executePaidJudgment = async (
  request: Request, deps: PaidRouteDeps, dataset: JudgmentDataset, input: JudgmentInput, payload: PaymentPayload,
  requirements: PaymentRequirements, fingerprint: string, bodyHash: string, requestId: string,
): Promise<Response> => {
  const verification = await verifyPayment(deps, payload, requirements);
  if (!verification) return errorResponse(502, 'Payment verification failed.');
  if ('invalid' in verification) return buildJudgmentChallenge(request, dataset, requirements, deps.settings, verification.invalid);
  const registered = await registerPayment(deps, dataset, input, payload, requirements, fingerprint, bodyHash, requestId, verification.payer);
  if (registered instanceof Response) return registered;
  return runAndSettle(deps, dataset, input, payload, requirements, registered, requestId, verification.payer);
};
