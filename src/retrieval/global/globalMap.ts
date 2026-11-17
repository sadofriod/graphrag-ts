import { agentRegistry } from '../../build/agents.md/agentRegistry';
import { assmblyAgent } from '../../build/agents.md/assmblyAgent';
import { parseLlmJson } from '../../helper/parseLlmJson';
import { logger } from '../../logger';
import { invokeSliceModel } from '../llm';
import { awaitRetrieval, throwIfRetrievalAborted } from '../retrievalContext';
import type { GlobalMapAnswer } from '../types/retrieval';
import type { SummaryBatch } from './summaryBatcher';

interface ParsedMapAnswer {
  answer: string;
  usefulness: number;
}

export interface MapBatchResult {
  answers: GlobalMapAnswer[];
  failures: Array<{ batchIndex: number; communityIds: string[]; error: Error }>;
  errors: Error[];
}

export const parseGlobalMapOutput = (raw: string): ParsedMapAnswer => {
  const parsed = parseLlmJson<unknown>(raw);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('answer' in parsed) ||
    !('usefulness' in parsed)
  ) {
    throw new Error('Global Map output must contain answer and usefulness fields.');
  }

  const { answer, usefulness } = parsed;
  if (
    typeof answer !== 'string' ||
    typeof usefulness !== 'number' ||
    !Number.isFinite(usefulness) ||
    usefulness < 0 ||
    usefulness > 100 ||
    (usefulness > 0 && answer.trim().length === 0)
  ) {
    throw new Error('Global Map output contains an invalid answer or usefulness score.');
  }

  return { answer: answer.trim(), usefulness };
};

const mapBatch = async (
  query: string,
  batch: SummaryBatch,
): Promise<GlobalMapAnswer> => {
  const prompt = await assmblyAgent(
    { query, content: batch.content },
    agentRegistry.globalMap,
  );
  const raw = await invokeSliceModel(prompt);
  return { ...parseGlobalMapOutput(raw), communityIds: batch.communityIds };
};

const runBatchWithRetry = async (
  query: string,
  batch: SummaryBatch,
  batchIndex: number,
): Promise<{ batchIndex: number; answer?: GlobalMapAnswer; error?: Error; communityIds: string[] }> => {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return { batchIndex, answer: await awaitRetrieval(() => mapBatch(query, batch)), communityIds: batch.communityIds };
    } catch (error) {
      throwIfRetrievalAborted();
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  const error = lastError ?? new Error(`Global Map batch ${batchIndex} failed.`);
  logger.warn({ batchIndex, communityIds: batch.communityIds, err: error }, 'Global Map batch failed after retry.');
  return { batchIndex, error, communityIds: batch.communityIds };
};

export const runGlobalMap = async (
  query: string,
  batches: readonly SummaryBatch[],
  concurrency: number,
): Promise<MapBatchResult> => {
  const results: Array<{
    batchIndex: number;
    answer?: GlobalMapAnswer;
    error?: Error;
    communityIds: string[];
  } | undefined> = Array.from({ length: batches.length });
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, batches.length);

  const workerResults = await Promise.allSettled(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < batches.length) {
        const batchIndex = nextIndex;
        nextIndex += 1;
        const batch = batches[batchIndex];
        if (batch) {
          results[batchIndex] = await runBatchWithRetry(query, batch, batchIndex);
        }
      }
    }),
  );
  const failedWorker = workerResults.find((result) => result.status === 'rejected');
  if (failedWorker?.status === 'rejected') {
    throw failedWorker.reason;
  }

  const answers = results.flatMap((result) => result?.answer ? [result.answer] : []);
  const failures = results.flatMap((result) =>
    result?.error
      ? [{ batchIndex: result.batchIndex, communityIds: result.communityIds, error: result.error }]
      : [],
  );
  const errors = failures.map(({ error }) => error);
  if (batches.length > 0 && answers.length === 0 && errors.length > 0) {
    throw new AggregateError(errors, 'Every Global Map batch failed.');
  }
  return { answers, failures, errors };
};
