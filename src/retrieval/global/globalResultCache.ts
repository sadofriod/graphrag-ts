import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prismaClient } from '../../build/helper/prismaClient';
import { awaitRetrieval, throwIfRetrievalAborted } from '../retrievalContext';
import type { GlobalRetrievalResult } from '../types/retrieval';

const decodeResult = (value: Prisma.JsonValue): GlobalRetrievalResult | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const { query, communityLevel, status, answer, selectedMapAnswers, failedMapBatches } = value;
  if (typeof query !== 'string' || typeof answer !== 'string' || status !== 'completed' ||
      (communityLevel !== 'leaf' && typeof communityLevel !== 'number') ||
      typeof failedMapBatches !== 'number' || !Array.isArray(selectedMapAnswers)) return undefined;
  const answers = selectedMapAnswers.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    if (typeof item.answer !== 'string' || typeof item.usefulness !== 'number' ||
        !Array.isArray(item.communityIds) || !item.communityIds.every((id) => typeof id === 'string')) return [];
    return [{ answer: item.answer, usefulness: item.usefulness, communityIds: item.communityIds }];
  });
  if (answers.length !== selectedMapAnswers.length) return undefined;
  return { query, communityLevel, status, answer, selectedMapAnswers: answers, failedMapBatches };
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