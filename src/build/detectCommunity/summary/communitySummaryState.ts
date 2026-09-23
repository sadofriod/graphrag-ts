import type { Embeddings } from '@langchain/core/embeddings';

import { buildCommunityContext, getCommunityContextMaxTokens } from './buildCommunityContext';
import { buildCommunityContextInput } from './buildCommunityContextInput';
import { computeCommunityFingerprint } from './communityFingerprint';
import { saveCommunitySummary } from './saveCommunitySummary';
import type { Community, CommunityClaimRow, CommunityEdgeRow } from '../types';
import type {
  ExistingSummaryRecord,
  SummaryAssignedItems,
  SummaryPersistenceState,
} from './communitySummaryTypes';

export const buildMemberToCommunityMap = (communities: readonly Community[]): ReadonlyMap<string, number> =>
  communities.reduce(
    (members, community) =>
      community.members.reduce(
        (nextMembers, member) => new Map(nextMembers).set(member, community.id),
        members,
      ),
    new Map<string, number>(),
  );

const countBySummaryId = <T extends { communitySummaryId?: string | null }>(
  rows: readonly T[],
): ReadonlyMap<string, number> =>
  rows.reduce(
    (counts, row) =>
      row.communitySummaryId
        ? new Map(counts).set(
          row.communitySummaryId,
          (counts.get(row.communitySummaryId) ?? 0) + 1,
        )
        : counts,
    new Map<string, number>(),
  );

export const computeSummaryAssignedCounts = (
  edgeRows: readonly CommunityEdgeRow[],
  claimRows: readonly CommunityClaimRow[],
): SummaryAssignedItems => ({
  edgeCountBySummaryId: countBySummaryId(edgeRows),
  claimCountBySummaryId: countBySummaryId(claimRows),
});

const findMatchingSummary = (
  community: Community,
  edgeRows: readonly CommunityEdgeRow[],
  claimRows: readonly CommunityClaimRow[],
  existingSummaries: readonly ExistingSummaryRecord[],
  assignedCounts: SummaryAssignedItems,
  contentFingerprint: string,
): ExistingSummaryRecord | undefined => {
  const memberSet = new Set(community.members);
  const communityEdges = edgeRows.filter(
    (edge) => memberSet.has(edge.sourceEntity.name) || memberSet.has(edge.targetEntity.name),
  );
  const communityClaims = claimRows.filter(
    (claim) => memberSet.has(claim.subjectEntity.name) ||
      (claim.objectEntity ? memberSet.has(claim.objectEntity.name) : false),
  );

  if (communityEdges.length === 0 && communityClaims.length === 0) {
    return undefined;
  }

  return existingSummaries.find((summary) => {
    const edgesMatch =
      communityEdges.length === (assignedCounts.edgeCountBySummaryId.get(summary.id) ?? 0) &&
      communityEdges.every((edge) => edge.communitySummaryId === summary.id);
    const claimsMatch =
      communityClaims.length === (assignedCounts.claimCountBySummaryId.get(summary.id) ?? 0) &&
      communityClaims.every((claim) => claim.communitySummaryId === summary.id);

    return edgesMatch && claimsMatch && summary.contentFingerprint === contentFingerprint;
  });
};

export const persistCommunity = async (
  state: SummaryPersistenceState,
  community: Community,
  edgeRows: readonly CommunityEdgeRow[],
  claimRows: readonly CommunityClaimRow[],
  entityDescriptions: ReadonlyMap<string, string | null>,
  existingSummaries: readonly ExistingSummaryRecord[],
  assignedCounts: SummaryAssignedItems,
  namespace: string,
  embeddingModel: Embeddings,
): Promise<SummaryPersistenceState> => {
  const input = buildCommunityContextInput(community, edgeRows, claimRows, entityDescriptions);
  const contentFingerprint = computeCommunityFingerprint(input);
  const matched = findMatchingSummary(
    community,
    edgeRows,
    claimRows,
    existingSummaries,
    assignedCounts,
    contentFingerprint,
  );

  if (matched) {
    return {
      ...state,
      communitySummaries: new Map(state.communitySummaries).set(community.id, {
        id: matched.id,
        name: matched.communityName,
      }),
      usedSummaryIds: new Set(state.usedSummaryIds).add(matched.id),
      reused: state.reused + 1,
    };
  }

  const saved = await saveCommunitySummary(
    community,
    buildCommunityContext(input, { maxTokens: getCommunityContextMaxTokens() }),
    contentFingerprint,
    namespace,
    embeddingModel,
  );

  return {
    ...state,
    communitySummaries: new Map(state.communitySummaries).set(community.id, saved),
    usedSummaryIds: new Set(state.usedSummaryIds).add(saved.id),
    updated: state.updated + 1,
  };
};