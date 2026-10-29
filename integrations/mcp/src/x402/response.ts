import type { GraphDataset } from './datasets.ts';
import { encodePaymentHeader, type SettleResponse } from './types.ts';
import type { runSnapshotQuery } from '../queryService.ts';
import { jsonResponse } from './http.ts';

export const responseSettlement = (record: { transaction: string | null; network: string; payer: string | null; amountSettled: string | null }): SettleResponse => ({
  success: true,
  transaction: record.transaction ?? '',
  network: record.network,
  ...(record.payer ? { payer: record.payer } : {}),
  ...(record.amountSettled ? { amount: record.amountSettled } : {}),
});

export const paymentBody = (
  dataset: GraphDataset,
  mode: 'local' | 'global',
  result: Awaited<ReturnType<typeof runSnapshotQuery>>['result'],
  version: { id: string; workspaceId: string },
  durationMs: number,
  payment: { payment_id: string; request_id: string; scheme: string; network: string; asset: string; amount: string; payer: string; transaction: string; settled_at: string },
) => {
  const sources = 'selectedMapAnswers' in result
    ? result.selectedMapAnswers.map((item) => ({ source: `map-answer:${item.communityIds.join(',')}`, excerpt: item.answer.slice(0, 500) }))
    : result.evidence.slice(0, 5).map((item) => ({ source: item.sourceDocumentId ?? item.sourceChunkId ?? 'GraphRAG evidence', excerpt: item.text.slice(0, 500) }));
  return {
    answer: result.answer,
    mode,
    dataset: { id: dataset.id, version: version.id, workspace_id: version.workspaceId },
    sources,
    usage: { query_ms: durationMs, map_answers: 'selectedMapAnswers' in result ? result.selectedMapAnswers.length : 0 },
    payment,
  };
};

export const settledResponse = (body: unknown, receipt: SettleResponse): Response =>
  jsonResponse(200, body, { 'payment-response': encodePaymentHeader(receipt) });
