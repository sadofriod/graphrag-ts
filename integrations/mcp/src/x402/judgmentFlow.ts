import { createHash, randomUUID } from 'node:crypto';
import type { JudgmentDataset } from './datasets.ts';
import { findDataset, isJudgmentDataset } from './datasets.ts';
import { buildJudgmentChallenge, matchRequirements } from './challenge.ts';
import { judgmentRequirements } from './pricing.ts';
import { errorResponse, jsonResponse } from './http.ts';
import { paidJudgmentRequestHash, nonceFromPayload, parsePaymentPayload, validIdempotencyKey, type PaidJudgmentInput } from './payload.ts';
import { encodePaymentHeader, type PaymentPayload, type PaymentRequirements, type SettleResponse } from './types.ts';
import { PaymentConflictError, PaymentReplayError, type PaymentRecord } from './payments.ts';
import type { PaidRouteDeps } from './routeTypes.ts';
import { withQuerySlot } from './slot.ts';
import { runReferenceBatch } from '../integrity/batch.ts';
import { runDependencyScan } from '../deps/scan.ts';
import { OsvUnavailableError, type OsvScanResult } from '../deps/osv.ts';

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

const invokeJudge = (dataset: JudgmentDataset, deps: PaidRouteDeps, input: PaidJudgmentInput) => {
  if (dataset.tool === 'dependency_scan') {
    if (!('packages' in input) || dataset.maxItems === undefined) throw new Error('Invalid dependency scan request.');
    return runDependencyScan(deps.advisories, input.packages, dataset.maxItems, input.ecosystem);
  }
  if (dataset.tool === 'reference_batch') {
    if (!('references' in input) || dataset.maxItems === undefined) throw new Error('Invalid reference batch request.');
    return runReferenceBatch(deps.judge, input.references, dataset.maxItems);
  }
  if ('references' in input || 'packages' in input) throw new Error('Batch requests require a matching batch dataset.');
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

const facilitatorErrorFields = (error: unknown) => {
  const detail = error as { name?: unknown; code?: unknown; status?: unknown; message?: unknown } | null;
  return {
    error_name: typeof detail?.name === 'string' ? detail.name : 'UnknownError',
    error_code: detail?.code ?? null,
    error_status: detail?.status ?? null,
    error_message: String(detail?.message ?? error).slice(0, 300),
  };
};

const verifyPayment = async (
  deps: PaidRouteDeps, payload: PaymentPayload, requirements: PaymentRequirements, datasetId?: string,
): Promise<Verification> => {
  try {
    const result = await deps.facilitator.verify({ paymentPayload: payload, paymentRequirements: requirements });
    if (!result.isValid) return { invalid: result.invalidReason ?? 'Payment is invalid.', ...(result.payer ? { payer: result.payer } : {}) };
    const claimed = payload.payload.authorization?.from ?? payload.payload.permit2Authorization?.from;
    const payer = result.payer ?? (typeof claimed === 'string' ? claimed : undefined);
    return payer?.trim() ? { payer: payer.trim().toLowerCase() } : undefined;
  } catch (error) {
    deps.logger.error('Facilitator verify failed.', {
      ...facilitatorErrorFields(error), network: requirements.network, amount: requirements.amount, dataset_id: datasetId ?? null,
    });
    return undefined;
  }
};

const registerPayment = async (
  deps: PaidRouteDeps, dataset: JudgmentDataset, input: PaidJudgmentInput, payload: PaymentPayload,
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
  deps: PaidRouteDeps, dataset: JudgmentDataset, input: PaidJudgmentInput, payload: PaymentPayload,
  requirements: PaymentRequirements, record: PaymentRecord, requestId: string, payer: string,
): Promise<Response> => {
  const started = performance.now();
  let judgment: unknown;
  if (dataset.tool === 'dependency_scan') {
    try {
      judgment = await invokeJudge(dataset, deps, input);
    } catch (error) {
      const scanError = error as { name?: unknown; message?: unknown; stack?: unknown } | null;
      const errorName = typeof scanError?.name === 'string' ? scanError.name : 'UnknownError';
      deps.logger.error('Dependency scan failed.', {
        error_name: errorName,
        error_message: String(scanError?.message).slice(0, 300),
        stack_head: String(scanError?.stack).split('\n').slice(0, 3).join(' | ').slice(0, 500),
        dataset_id: dataset.id, packages: 'packages' in input && Array.isArray(input.packages) ? input.packages.length : null,
      });
      const unavailable = error instanceof OsvUnavailableError;
      await deps.payments.failPayment(record.id, { errorReason: unavailable ? 'advisory_source_unavailable' : 'dependency_scan_failed', payer });
      return unavailable ? errorResponse(503, 'advisory_source_unavailable')
        : jsonResponse(502, { error: 'dependency_scan_failed', detail: errorName });
    }
    const scan = judgment as OsvScanResult;
    deps.logger.info('Dependency scan completed.', {
      dataset_id: dataset.id, packages: 'packages' in input && Array.isArray(input.packages) ? input.packages.length : null,
      query_ms: scan.query_ms, partial: scan.partial, advisory_count: scan.summary.advisory_count,
      duration_ms: Math.max(0, performance.now() - started),
    });
  } else try { judgment = await invokeJudge(dataset, deps, input); } catch (error) {
    const unavailable = error instanceof OsvUnavailableError;
    const noSnapshot = error instanceof Error && error.message.includes('No active integrity snapshot');
    await deps.payments.failPayment(record.id, { errorReason: unavailable ? 'advisory_source_unavailable' : noSnapshot ? 'no_snapshot' : 'judge_failed', payer });
    return unavailable ? errorResponse(503, 'advisory_source_unavailable') : errorResponse(noSnapshot ? 503 : 502, noSnapshot ? 'NO_SNAPSHOT' : 'JUDGE_FAILED');
  }
  const judgeMs = Math.max(0, performance.now() - started);
  return settleJudgment(deps, dataset, payload, requirements, record, requestId, payer, judgment, judgeMs);
};

const settleJudgment = async (
  deps: PaidRouteDeps, dataset: JudgmentDataset, payload: PaymentPayload, requirements: PaymentRequirements,
  record: PaymentRecord, requestId: string, payer: string, judgment: unknown, judgeMs: number,
): Promise<Response> => {
  const settledAt = new Date((deps.now ?? Date.now)()).toISOString();
  const body = { dataset: { id: dataset.id, tool: dataset.tool }, judgment, usage: { judge_ms: Math.round(judgeMs) }, payment: {
    payment_id: record.id, request_id: requestId, scheme: record.scheme, network: record.network,
    asset: record.asset, amount: requirements.amount, payer, transaction: '', settled_at: settledAt,
  } };
  if (!await deps.payments.beginSettlement(record.id, body, requirements)) return jsonResponse(409, { status: 'payment_not_claimed', request_id: requestId });
  let settlement: SettleResponse;
  try { settlement = await deps.facilitator.settle({ paymentPayload: payload, paymentRequirements: requirements }); } catch (error) {
    const errorTransaction = (error as { transaction?: unknown } | null)?.transaction;
    deps.logger.error('Facilitator settle failed.', {
      ...facilitatorErrorFields(error), dataset_id: dataset.id,
      transaction: typeof errorTransaction === 'string' ? errorTransaction.slice(0, 12) : record.transaction?.slice(0, 12) ?? null,
      network: requirements.network, amount: requirements.amount,
    });
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
  const completion = {
    payer: body.payment.payer, transaction: settlement.transaction, amountSettled: amount,
    responseBody: body, datasetVersion: (body.judgment as { snapshot?: { id?: string } })?.snapshot?.id ?? 'judgment',
    latencyMs: Math.max(0, Math.round(Number(body.usage.judge_ms))),
  };
  try {
    await deps.payments.completePayment(record.id, completion);
  } catch {
    try {
      await deps.payments.completePayment(record.id, completion);
    } catch (error) {
      deps.logger.error('Judgment payment ledger write failed after settlement.', {
        dataset_id: dataset.id, payment_id: record.id, result_code: 'ledger_write_failed',
        error_name: error instanceof Error ? error.name : 'UnknownError',
        error_message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
  return jsonResponse(200, body, { 'payment-response': encodePaymentHeader({ ...settlement, amount }) });
};

type JudgmentResponseBody = {
  readonly dataset: { readonly id: string; readonly tool: string }; readonly judgment: unknown; readonly usage: { readonly judge_ms: number };
  readonly payment: { readonly payment_id: string; readonly request_id: string; readonly scheme: string; readonly network: string; readonly asset: string; readonly amount: string; readonly payer: string; readonly transaction: string; readonly settled_at: string };
};

export const handlePaidJudgment = async (request: Request, input: PaidJudgmentInput, deps: PaidRouteDeps, fixedBatchRoute = false): Promise<Response> => {
  const dataset = findDataset(deps.registry, input.dataset_id);
  if (!dataset || !isJudgmentDataset(dataset)) return errorResponse(404, 'Unknown judgment dataset.');
  if (dataset.tool === 'dependency_scan' && !('packages' in input)) return errorResponse(400, 'Dependency scan requests require packages.');
  if (dataset.tool !== 'dependency_scan' && 'packages' in input) return errorResponse(400, 'Dependency scan requests require a dependency_scan dataset.');
  const requirements = judgmentRequirements(dataset, deps.settings);
  const signature = request.headers.get('PAYMENT-SIGNATURE');
  if (!signature) return buildJudgmentChallenge(request, dataset, requirements, deps.settings, undefined, fixedBatchRoute);
  const decoded = parsePaymentPayload(signature);
  if (!decoded.payload) return errorResponse(400, decoded.error ?? 'Payment payload is invalid.');
  const payload = decoded.payload;
  const fingerprint = createHash('sha256').update(signature).digest('hex');
  const bodyHash = paidJudgmentRequestHash(input);
  const replay = await replayByFingerprint(deps, dataset, fingerprint, bodyHash);
  if (replay) return replay;
  const matchedRequirements = matchRequirements(payload.accepted, requirements);
  if (!matchedRequirements) return buildJudgmentChallenge(request, dataset, requirements, deps.settings, 'payment requirements do not match', fixedBatchRoute);
  const key = request.headers.get('Idempotency-Key');
  if (!validIdempotencyKey(key)) return errorResponse(400, 'Invalid Idempotency-Key.');
  const requestId = key ?? `payment:${fingerprint}`;
  return withQuerySlot(deps.limiter, () => errorResponse(503, 'The server has reached its active query limit. Try again shortly.'),
    async () => executePaidJudgment(request, deps, dataset, input, payload, matchedRequirements, requirements, fingerprint, bodyHash, requestId, fixedBatchRoute));
};

const executePaidJudgment = async (
  request: Request, deps: PaidRouteDeps, dataset: JudgmentDataset, input: PaidJudgmentInput, payload: PaymentPayload,
  requirements: PaymentRequirements, allRequirements: readonly PaymentRequirements[], fingerprint: string, bodyHash: string, requestId: string, fixedBatchRoute: boolean,
): Promise<Response> => {
  const verification = await verifyPayment(deps, payload, requirements, dataset.id);
  if (!verification) return errorResponse(502, 'Payment verification failed.');
  if ('invalid' in verification) return buildJudgmentChallenge(request, dataset, allRequirements, deps.settings, verification.invalid, fixedBatchRoute);
  const registered = await registerPayment(deps, dataset, input, payload, requirements, fingerprint, bodyHash, requestId, verification.payer);
  if (registered instanceof Response) return registered;
  return runAndSettle(deps, dataset, input, payload, requirements, registered, requestId, verification.payer);
};
