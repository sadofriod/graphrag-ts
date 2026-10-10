import { agentRegistry } from '../../build/agents.md/agentRegistry';
import { assmblyAgent } from '../../build/agents.md/assmblyAgent';
import { prismaClient } from '../../build/helper/prismaClient';
import { awaitRetrieval } from '../retrievalContext';
import { getRetrievalDefaults } from '../../config/defaults';
import { getCurrentNamespace } from '../../namespace/namespaceContext';
import { logger } from '../../logger';
import type {
  GlobalRetrievalRequest,
  GlobalRetrievalResult,
} from '../types/retrieval';
import { runGlobalMap } from './globalMap';
import { generateGlobalReduceAnswer, selectGlobalReduceAnswers } from './globalReduce';
import { buildSummaryBatches } from './summaryBatcher';

const NO_RESULTS_ANSWER = 'No relevant community summaries were found for this query.';

interface GlobalSearchSettings {
  communityLevel: number;
  mapTokenBudget: number;
  reduceTokenBudget: number;
  mapOutputReserve: number;
  reduceOutputReserve: number;
  mapConcurrency: number;
}

const positiveInteger = (value: number, name: string): number => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
  return value;
};

const nonNegativeInteger = (value: number, name: string): number => {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer.`);
  }
  return value;
};

const chooseSetting = <T>(
  requested: T | undefined,
  configured: T | undefined,
  fallback: T,
): T => {
  if (requested !== undefined) {
    return requested;
  }
  if (configured !== undefined) {
    return configured;
  }
  return fallback;
};

const resolveSettings = (request: GlobalRetrievalRequest): GlobalSearchSettings => {
  const options = request.options ?? {};
  const defaults = getRetrievalDefaults();
  return {
    communityLevel: nonNegativeInteger(chooseSetting(options.communityLevel, undefined, 0), 'communityLevel'),
    mapTokenBudget: positiveInteger(chooseSetting(options.mapTokenBudget, defaults.globalMapTokenBudget, 8000), 'mapTokenBudget'),
    reduceTokenBudget: positiveInteger(chooseSetting(options.reduceTokenBudget, defaults.globalReduceTokenBudget, 8000), 'reduceTokenBudget'),
    mapOutputReserve: nonNegativeInteger(chooseSetting(options.mapOutputReserve, defaults.globalMapOutputReserve, 512), 'mapOutputReserve'),
    reduceOutputReserve: nonNegativeInteger(chooseSetting(options.reduceOutputReserve, defaults.globalReduceOutputReserve, 1024), 'reduceOutputReserve'),
    mapConcurrency: positiveInteger(chooseSetting(options.mapConcurrency, defaults.globalMapConcurrency, 4), 'mapConcurrency'),
  };
};

const noResults = (
  query: string,
  communityLevel: number,
  failedMapBatches = 0,
): GlobalRetrievalResult => ({
  query,
  communityLevel,
  status: 'no_results',
  answer: NO_RESULTS_ANSWER,
  selectedMapAnswers: [],
  failedMapBatches,
});

const loadSummaries = async (communityLevel: number) => {
  const summaries = await awaitRetrieval(() => prismaClient.rAGCommunitySummary.findMany({
    where: { namespace: getCurrentNamespace(), level: communityLevel },
    select: { id: true, summaryContent: true },
    orderBy: { id: 'asc' },
  }));
  return summaries
    .filter((summary) => summary.summaryContent.trim().length > 0)
    .map(({ id, summaryContent }) => ({ id, text: summaryContent }));
};

const makeMapBatches = async (
  query: string,
  summaries: Awaited<ReturnType<typeof loadSummaries>>,
  promptBudget: number,
) => {
  const mapPromptSkeleton = await awaitRetrieval(() => assmblyAgent(
    { query, content: '' },
    agentRegistry.globalMap,
  ));
  return buildSummaryBatches(summaries, mapPromptSkeleton, promptBudget);
};

const generateGlobalResult = async (
  query: string,
  communityLevel: number,
  mapAnswers: Awaited<ReturnType<typeof runGlobalMap>>,
  summariesCount: number,
  batchesCount: number,
  reducePromptBudget: number,
): Promise<GlobalRetrievalResult> => {
  const rankedAnswers = mapAnswers.answers
    .filter((answer) => answer.usefulness > 0)
    .sort((left, right) => right.usefulness - left.usefulness);
  if (rankedAnswers.length === 0) {
    return noResults(query, communityLevel, mapAnswers.errors.length);
  }

  const reducePromptSkeleton = await awaitRetrieval(() => assmblyAgent(
    { query, content: '' },
    agentRegistry.globalReduce,
  ));
  const selectedAnswers = selectGlobalReduceAnswers(
    rankedAnswers,
    reducePromptSkeleton,
    reducePromptBudget,
  );
  if (selectedAnswers.length === 0) {
    logger.warn({ query, reducePromptBudget }, 'No Global Map answer fit the Reduce token budget.');
    return noResults(query, communityLevel, mapAnswers.errors.length);
  }

  const reduceResult = await awaitRetrieval(() => generateGlobalReduceAnswer(query, selectedAnswers));
  logger.debug({
    communityLevel,
    summaryCount: summariesCount,
    mapBatchCount: batchesCount,
    mapBatches: mapAnswers.answers.map((item) => item.communityIds),
    failedMapBatches: mapAnswers.errors.length,
    mapScores: mapAnswers.answers.map(({ usefulness, communityIds }) => ({ usefulness, communityIds })),
    selectedMapAnswers: selectedAnswers.length,
    reducePromptTokens: reduceResult.promptTokens,
  }, 'Global retrieval completed.');

  return {
    query,
    communityLevel,
    status: mapAnswers.errors.length > 0 ? 'partial' : 'completed',
    answer: reduceResult.answer,
    selectedMapAnswers: selectedAnswers,
    failedMapBatches: mapAnswers.errors.length,
  };
};

export const retrieveGlobal = async (
  request: GlobalRetrievalRequest,
): Promise<GlobalRetrievalResult> => {
  const query = request.query.trim();
  if (!query) {
    throw new Error('Global retrieval query must not be empty.');
  }
  const settings = resolveSettings(request);
  const mapPromptBudget = settings.mapTokenBudget - settings.mapOutputReserve;
  const reducePromptBudget = settings.reduceTokenBudget - settings.reduceOutputReserve;
  if (mapPromptBudget <= 0 || reducePromptBudget <= 0) {
    throw new RangeError('Token budgets must exceed their output reserves.');
  }

  const summaries = await loadSummaries(settings.communityLevel);
  if (summaries.length === 0) {
    return noResults(query, settings.communityLevel);
  }

  const batches = await makeMapBatches(query, summaries, mapPromptBudget);
  const mapAnswers = await runGlobalMap(query, batches, settings.mapConcurrency);
  return awaitRetrieval(() => generateGlobalResult(
    query,
    settings.communityLevel,
    mapAnswers,
    summaries.length,
    batches.length,
    reducePromptBudget,
  ));
};
