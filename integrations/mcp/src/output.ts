import type {
  GlobalRetrievalResult,
  RetrievalResult,
} from '@ashes_born/graph-rag-ts/retrieval/types/retrieval';
import { formatWithBudget } from './output/format-with-budget.ts';

export type QueryOutput = {
  readonly answer: string;
  readonly sources: readonly { readonly source: string; readonly excerpt: string }[];
  readonly index_version: { readonly id: string; readonly namespace: string };
  readonly truncated: boolean;
};

export const formatQueryOutput = (
  result: RetrievalResult,
  version: { readonly id: string; readonly namespace: string },
  maxChars: number,
): string => {
  const sources = result.evidence.slice(0, 5).map((evidence) => ({
    source: evidence.sourceDocumentId ?? evidence.sourceChunkId ?? 'GraphRAG evidence',
    excerpt: evidence.text.slice(0, 500),
  }));
  const truncated = result.evidence.length > sources.length || result.evidence.some((item) => item.text.length > 500);

  return formatWithBudget(
    result.answer,
    sources,
    truncated,
    maxChars,
    (answer, selectedSources, isTruncated) => JSON.stringify({
      answer,
      sources: selectedSources,
      index_version: version,
      truncated: isTruncated,
    } satisfies QueryOutput),
  );
};

export const formatGlobalQueryOutput = (
  result: GlobalRetrievalResult,
  version: { readonly id: string; readonly namespace: string },
  maxChars: number,
): string => {
  const selectedMapAnswers = result.selectedMapAnswers.slice(0, 5).map((item) => ({
    answer: item.answer.slice(0, 500),
    usefulness: item.usefulness,
    community_ids: item.communityIds,
  }));
  const truncated = result.selectedMapAnswers.length > selectedMapAnswers.length
    || result.selectedMapAnswers.some((item) => item.answer.length > 500);

  return formatWithBudget(
    result.answer,
    selectedMapAnswers,
    truncated,
    maxChars,
    (answer, selectedAnswers, isTruncated) => JSON.stringify({
      answer,
      status: result.status,
      community_level: result.communityLevel,
      selected_map_answers: selectedAnswers,
      failed_map_batches: result.failedMapBatches,
      index_version: version,
      truncated: isTruncated,
    }),
  );
};