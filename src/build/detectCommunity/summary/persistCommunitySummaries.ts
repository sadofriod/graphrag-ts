import type { Embeddings } from '@langchain/core/embeddings';

import { prismaClient } from '../../helper/prismaClient';
import { modelLoaderSingleton } from '../../modelLoader';
import { backfillCommunityAssignments } from './backfillCommunityAssignments';
import {
  buildMemberToCommunityMap,
  computeSummaryAssignedCounts,
  persistCommunity,
} from './communitySummaryState';
import { loadCommunitySummaryData } from './loadCommunitySummaryData';
import type { CommunityDetectionResult } from '../types';
import type { SummaryPersistenceState } from './communitySummaryTypes';

export interface PersistSummaryResult {
  readonly total: number;
  readonly reused: number;
  readonly updated: number;
}

export const persistCommunitySummaries = async (
  result: CommunityDetectionResult,
  namespace: string,
): Promise<PersistSummaryResult> => {
  const embeddingModel = modelLoaderSingleton.models?.embedding as Embeddings | undefined;
  if (!embeddingModel) {
    throw new Error('Embedding model is not loaded. Please check the configuration for the embedding model.');
  }

  const { edgeRows, claimRows, entityDescriptions, existingSummaries } =
    await loadCommunitySummaryData(namespace);
  const assignedCounts = computeSummaryAssignedCounts(edgeRows, claimRows);
  const memberToCommunity = buildMemberToCommunityMap(result.communities);
  const finalState = await result.communities.reduce<Promise<SummaryPersistenceState>>(
    async (statePromise, community) =>
      persistCommunity(
        await statePromise,
        community,
        edgeRows,
        claimRows,
        entityDescriptions,
        existingSummaries,
        assignedCounts,
        namespace,
        embeddingModel,
      ),
    Promise.resolve({
      communitySummaries: new Map<number, { id: string; name: string }>(),
      usedSummaryIds: new Set<string>(),
      reused: 0,
      updated: 0,
    }),
  );

  const staleSummaryIds = existingSummaries
    .filter((summary) => !finalState.usedSummaryIds.has(summary.id))
    .map((summary) => summary.id);

  if (staleSummaryIds.length > 0 && prismaClient.rAGCommunitySummary.deleteMany) {
    await prismaClient.rAGCommunitySummary.deleteMany({
      where: { id: { in: staleSummaryIds }, namespace },
    });
  }

  await backfillCommunityAssignments(
    edgeRows,
    claimRows,
    memberToCommunity,
    finalState.communitySummaries,
  );

  return {
    total: result.communities.length,
    reused: finalState.reused,
    updated: finalState.updated,
  };
};