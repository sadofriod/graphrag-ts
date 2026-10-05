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
import type { CommunityDetectionResult, HierarchicalCommunity } from '../types';
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
  const hierarchy = result.hierarchy ?? result.communities.map((community) => ({
    ...community,
    level: 0,
    parentId: null,
    children: [],
  }));
  const leafCommunities = hierarchy.flatMap((community) =>
    community.children.length > 0 ? getLeafCommunities(community.children) : [community]
  );
  const memberToCommunity = buildMemberToCommunityMap(leafCommunities);
  const initialState: SummaryPersistenceState = {
    communitySummaries: new Map<number, { id: string; name: string; content: string }>(),
    usedSummaryIds: new Set<string>(),
    reused: 0,
    updated: 0,
  };
  const finalState = await hierarchy.reduce<Promise<SummaryPersistenceState>>(
    async (statePromise, community) => {
      const state = await statePromise;
      const { state: nextState } = await persistHierarchyNode(
        community,
        state,
        edgeRows,
        claimRows,
        entityDescriptions,
        existingSummaries,
        assignedCounts,
        namespace,
        embeddingModel,
      );

      return nextState;
    },
    Promise.resolve(initialState),
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
    total: countHierarchyNodes(hierarchy),
    reused: finalState.reused,
    updated: finalState.updated,
  };
};

const getLeafCommunities = (communities: HierarchicalCommunity[]): HierarchicalCommunity[] =>
  communities.flatMap((community) =>
    community.children.length > 0 ? getLeafCommunities(community.children) : [community]
  );

const countHierarchyNodes = (communities: HierarchicalCommunity[]): number =>
  communities.reduce(
    (count, community) => count + 1 + countHierarchyNodes(community.children),
    0,
  );

const persistHierarchyNode = async (
  community: HierarchicalCommunity,
  state: SummaryPersistenceState,
  edgeRows: Parameters<typeof persistCommunity>[2],
  claimRows: Parameters<typeof persistCommunity>[3],
  entityDescriptions: Parameters<typeof persistCommunity>[4],
  existingSummaries: Parameters<typeof persistCommunity>[5],
  assignedCounts: Parameters<typeof persistCommunity>[6],
  namespace: string,
  embeddingModel: Embeddings,
): Promise<{
  state: SummaryPersistenceState;
  summary: { id: string; name: string; content: string };
}> => {
  const children = await community.children.reduce<Promise<Array<{
    state: SummaryPersistenceState;
    summary: { id: string; name: string; content: string };
  }>>>(
    async (pendingChildren, child) => {
      const persistedChildren = await pendingChildren;
      const previousState = persistedChildren.at(-1)?.state ?? state;
      const persisted = await persistHierarchyNode(
        child,
        previousState,
        edgeRows,
        claimRows,
        entityDescriptions,
        existingSummaries,
        assignedCounts,
        namespace,
        embeddingModel,
      );

      return [...persistedChildren, persisted];
    },
    Promise.resolve([]),
  );
  const stateAfterChildren = children.at(-1)?.state ?? state;
  const nextState = await persistCommunity(
    stateAfterChildren,
    community,
    edgeRows,
    claimRows,
    entityDescriptions,
    existingSummaries,
    assignedCounts,
    namespace,
    embeddingModel,
    community.level,
    children.map(({ summary }) => ({
      communityName: summary.name,
      summaryContent: summary.content,
    })),
  );
  const summary = nextState.communitySummaries.get(community.id);

  if (!summary) {
    throw new Error(`Missing persisted summary for community ${community.id}`);
  }

  await children.reduce<Promise<void>>(
    async (pendingUpdate, child) => {
      await pendingUpdate;
      await prismaClient.rAGCommunitySummary.update({
        where: { id: child.summary.id },
        data: { parentCommunityId: summary.id },
      });
    },
    Promise.resolve(),
  );

  return { state: nextState, summary };
};