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
  communityLevel: number | 'leaf';
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
  const requestedLevel = chooseSetting(options.communityLevel, undefined, 'leaf');
  return {
    communityLevel: requestedLevel === 'leaf'
      ? requestedLevel
      : nonNegativeInteger(requestedLevel, 'communityLevel'),
    mapTokenBudget: positiveInteger(chooseSetting(options.mapTokenBudget, defaults.globalMapTokenBudget, 8000), 'mapTokenBudget'),
    reduceTokenBudget: positiveInteger(chooseSetting(options.reduceTokenBudget, defaults.globalReduceTokenBudget, 8000), 'reduceTokenBudget'),
    mapOutputReserve: nonNegativeInteger(chooseSetting(options.mapOutputReserve, defaults.globalMapOutputReserve, 512), 'mapOutputReserve'),
    reduceOutputReserve: nonNegativeInteger(chooseSetting(options.reduceOutputReserve, defaults.globalReduceOutputReserve, 1024), 'reduceOutputReserve'),
    mapConcurrency: positiveInteger(chooseSetting(options.mapConcurrency, defaults.globalMapConcurrency, 4), 'mapConcurrency'),
  };
};

const noResults = (
  query: string,
  communityLevel: number | 'leaf',
  failedMapBatches = 0,
): GlobalRetrievalResult => ({
  query,
  communityLevel,
  status: 'no_results',
  answer: NO_RESULTS_ANSWER,
  selectedMapAnswers: [],
  failedMapBatches,
});

interface CommunitySummaryRow {
  id: string;
  level: number;
  summaryContent: string;
  parentCommunityId: string | null;
}

const findLeafSummaries = (summaries: readonly CommunitySummaryRow[]): CommunitySummaryRow[] => {
  const parentIds = new Set(
    summaries.flatMap(({ parentCommunityId }) => parentCommunityId ? [parentCommunityId] : []),
  );
  return summaries.filter(({ id }) => !parentIds.has(id));
};

const buildDescendantLeafIds = (
  summaries: readonly CommunitySummaryRow[],
  leaves: readonly CommunitySummaryRow[],
): Map<string, string[]> => {
  const summariesById = new Map(summaries.map((summary) => [summary.id, summary]));
  const descendants = new Map<string, string[]>();
  for (const leaf of leaves) {
    descendants.set(leaf.id, [leaf.id]);
    let ancestorId = leaf.parentCommunityId;
    while (ancestorId) {
      const leafIds = descendants.get(ancestorId) ?? [];
      leafIds.push(leaf.id);
      descendants.set(ancestorId, leafIds);
      ancestorId = summariesById.get(ancestorId)?.parentCommunityId ?? null;
    }
  }
  return descendants;
};

const loadClaimsForLeaves = async (namespace: string, leafIds: readonly string[]) => {
  if (leafIds.length === 0) {
    return [];
  }
  return awaitRetrieval(() => prismaClient.rAGClaim.findMany({
    where: {
      namespace,
      communitySummaryId: { in: [...leafIds] },
    },
    select: {
      communitySummaryId: true,
      description: true,
      subjectEntity: { select: { name: true } },
      objectEntity: { select: { name: true } },
      sourceChunk: { select: { content: true } },
    },
  }));
};

type CommunityClaim = Awaited<ReturnType<typeof loadClaimsForLeaves>>[number];

const groupClaimsBySummary = (claims: readonly CommunityClaim[]): Map<string, CommunityClaim[]> => {
  const grouped = new Map<string, CommunityClaim[]>();
  for (const claim of claims) {
    if (claim.communitySummaryId) {
      const summaryClaims = grouped.get(claim.communitySummaryId) ?? [];
      summaryClaims.push(claim);
      grouped.set(claim.communitySummaryId, summaryClaims);
    }
  }
  return grouped;
};

const formatMapSummary = (
  summary: CommunitySummaryRow,
  leafIds: readonly string[],
  claimsBySummary: ReadonlyMap<string, readonly CommunityClaim[]>,
): string => {
  const claims = leafIds.flatMap((leafId) => claimsBySummary.get(leafId) ?? []);
  const factLines = claims.map(({ subjectEntity, objectEntity, description }) =>
    `- ${subjectEntity.name}${objectEntity ? ` -> ${objectEntity.name}` : ''}: ${description}`,
  );
  const sourceExcerpts = [...new Set(
    claims.flatMap(({ sourceChunk }) => sourceChunk?.content.trim() ? [sourceChunk.content.trim()] : []),
  )];
  const parts = [`[Community summary]\n${summary.summaryContent}`];
  if (factLines.length > 0) {
    parts.push(`[Supporting claims]\n${factLines.join('\n')}`);
  }
  if (sourceExcerpts.length > 0) {
    parts.push(`[Source excerpts]\n${sourceExcerpts.map((excerpt) => `- ${excerpt}`).join('\n')}`);
  }
  return parts.join('\n\n');
};

const loadSummaries = async (communityLevel: number | 'leaf') => {
  const namespace = getCurrentNamespace();
  const summaries = await awaitRetrieval(() => prismaClient.rAGCommunitySummary.findMany({
    where: { namespace },
    select: { id: true, summaryContent: true, parentCommunityId: true, level: true },
    orderBy: { id: 'asc' },
  }));
  const leaves = findLeafSummaries(summaries);
  const leafIds = new Set(leaves.map(({ id }) => id));
  const descendantLeafIds = buildDescendantLeafIds(summaries, leaves);
  const selectedSummaries = summaries.filter((summary) =>
    summary.summaryContent.trim().length > 0 &&
    (communityLevel === 'leaf'
      ? leafIds.has(summary.id)
      : summary.level === communityLevel)
  );
  if (selectedSummaries.length === 0) {
    return [];
  }
  const leafIdsBySummary = new Map(
    selectedSummaries.map(({ id }) => [id, descendantLeafIds.get(id) ?? []]),
  );
  const leafSummaryIds = [...new Set([...leafIdsBySummary.values()].flat())];
  const claims = await loadClaimsForLeaves(namespace, leafSummaryIds);
  const claimsBySummary = groupClaimsBySummary(claims);
  return selectedSummaries.map((summary) => ({
    id: summary.id,
    text: formatMapSummary(summary, leafIdsBySummary.get(summary.id) ?? [], claimsBySummary),
  }));
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
  return buildSummaryBatches(summaries, mapPromptSkeleton.prompt, promptBudget);
};

const generateGlobalResult = async (
  query: string,
  communityLevel: number | 'leaf',
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
    reducePromptSkeleton.prompt,
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
