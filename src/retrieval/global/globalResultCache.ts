import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prismaClient } from '../../build/helper/prismaClient';
import { awaitRetrieval, throwIfRetrievalAborted } from '../retrievalContext';
import type { GlobalRetrievalResult } from '../types/retrieval';

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

interface CachedGlobalResult extends Prisma.JsonObject {
  query: string;
  communityLevel: number | 'leaf';
  status: 'completed';
  answer: string;
  selectedMapAnswers: Prisma.JsonArray;
  failedMapBatches: number;
  failedCommunities: string[];
  retainedCommunities: string[];
  droppedForBudget: string[];
  budgetLimited: boolean;
}

const hasValidResultFields = (value: Prisma.JsonObject): value is CachedGlobalResult =>
  typeof value.query === 'string' && typeof value.answer === 'string' && value.status === 'completed' &&
  (value.communityLevel === 'leaf' || typeof value.communityLevel === 'number') &&
  typeof value.failedMapBatches === 'number' && Array.isArray(value.selectedMapAnswers) &&
  isStringArray(value.failedCommunities) && isStringArray(value.retainedCommunities) &&
  isStringArray(value.droppedForBudget) && typeof value.budgetLimited === 'boolean';

const decodeResult = (value: Prisma.JsonValue): GlobalRetrievalResult | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  if (!hasValidResultFields(value)) return undefined;
  const {
    query, communityLevel, status, answer, selectedMapAnswers, failedMapBatches,
    failedCommunities, retainedCommunities, droppedForBudget, budgetLimited,
  } = value;
  const answers = selectedMapAnswers.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    if (typeof item.answer !== 'string' || typeof item.usefulness !== 'number' ||
        !Array.isArray(item.communityIds) || !item.communityIds.every((id) => typeof id === 'string')) return [];
    return [{ answer: item.answer, usefulness: item.usefulness, communityIds: item.communityIds }];
  });
  if (answers.length !== selectedMapAnswers.length) return undefined;
  return {
    query, communityLevel, status, answer, selectedMapAnswers: answers, failedMapBatches,
    failedCommunities, retainedCommunities, droppedForBudget, budgetLimited,
  };
};

export const withCachedGlobalResult = (
  input: { readonly namespace: string; readonly fingerprint: unknown },
  generate: () => Promise<GlobalRetrievalResult>,
): Promise<GlobalRetrievalResult> => {
  const cacheKey = createHash('sha256').update(JSON.stringify(input.fingerprint)).digest('hex');
  const { namespace } = input;
  return awaitRetrieval(() => prismaClient.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`${namespace}:${cacheKey}`}, 1))`;
    throwIfRetrievalAborted();
    const cached = await transaction.rAGGlobalQueryCache.findUnique({
      where: { namespace_cacheKey: { namespace, cacheKey } },
    });
    const decoded = cached ? decodeResult(cached.result) : undefined;
    if (decoded) return decoded;
    const result = await generate();
    throwIfRetrievalAborted();
    if (result.status === 'completed') {
      const data = { ...result, selectedMapAnswers: result.selectedMapAnswers.map((answer) => ({ ...answer })) };
      await transaction.rAGGlobalQueryCache.upsert({
        where: { namespace_cacheKey: { namespace, cacheKey } },
        create: { namespace, cacheKey, result: data },
        update: { result: data },
      });
    }
    return result;
  }, { timeout: 300_000, maxWait: 10_000 }));
};
