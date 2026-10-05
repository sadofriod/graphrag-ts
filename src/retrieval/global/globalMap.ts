import { agentRegistry } from '../../build/agents.md/agentRegistry';
import { assmblyAgent } from '../../build/agents.md/assmblyAgent';
import { parseLlmJson } from '../../helper/parseLlmJson';
import { logger } from '../../logger';
import { invokeSliceModel } from '../llm';
import type { GlobalMapAnswer } from '../types/retrieval';
import type { SummaryBatch } from './summaryBatcher';

interface ParsedMapAnswer {
  answer: string;
  usefulness: number;
}

export interface MapBatchResult {
  answers: GlobalMapAnswer[];
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
): Promise<{ answer?: GlobalMapAnswer; error?: Error }> => {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return { answer: await mapBatch(query, batch) };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  const error = lastError ?? new Error(`Global Map batch ${batchIndex} failed.`);
  logger.warn({ batchIndex, communityIds: batch.communityIds, err: error }, 'Global Map batch failed after retry.');
  return { error };
};

export const runGlobalMap = async (
  query: string,
  batches: readonly SummaryBatch[],
  concurrency: number,
): Promise<MapBatchResult> => {
  const results: Array<{ answer?: GlobalMapAnswer; error?: Error } | undefined> =
    Array.from({ length: batches.length });
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, batches.length);

  await Promise.all(
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

  const answers = results.flatMap((result) => result?.answer ? [result.answer] : []);
  const errors = results.flatMap((result) => result?.error ? [result.error] : []);
  if (batches.length > 0 && answers.length === 0 && errors.length > 0) {
    throw new AggregateError(errors, 'Every Global Map batch failed.');
  }
  return { answers, errors };
};
