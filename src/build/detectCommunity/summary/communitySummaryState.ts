import type { Embeddings } from '@langchain/core/embeddings';

import { buildCommunityContext, getCommunityContextMaxTokens } from './buildCommunityContext';
import { buildCommunityContextInput } from './buildCommunityContextInput';
import { buildHierarchySummaryContext, type ChildCommunitySummary } from './buildHierarchySummaryContext';
import { computeCommunityFingerprint } from './communityFingerprint';
import { saveCommunitySummary } from './saveCommunitySummary';
import type { Community, CommunityClaimRow, CommunityEdgeRow } from '../types';
import type { ExistingSummaryRecord, SummaryPersistenceState } from './communitySummaryTypes';

export const buildMemberToCommunityMap = (communities: readonly Community[]): ReadonlyMap<string, number> => {
  const members = new Map<string, number>();

  for (const community of communities) {
    for (const member of community.members) {
      members.set(member, community.id);
    }
  }

  return members;
};

const buildSummaryContext = (
  input: ReturnType<typeof buildCommunityContextInput>,
  childSummaries: ChildCommunitySummary[],
): { content: string; usesChildReports: boolean } => {
  const maxTokens = getCommunityContextMaxTokens();
  const detailedContext = buildCommunityContext(input, { maxTokens: Number.MAX_SAFE_INTEGER });
  const boundedContext = buildCommunityContext(input, { maxTokens });
  const content = buildHierarchySummaryContext(
    detailedContext,
    boundedContext,
    childSummaries,
    maxTokens,
  );

  return {
    content,
    usesChildReports: childSummaries.length > 0 &&
      content !== detailedContext &&
      content !== boundedContext,
  };
};

const findMatchingSummary = (
  community: Community,
  level: number,
  existingSummaries: readonly ExistingSummaryRecord[],
  contentFingerprint: string,
  usedSummaryIds: ReadonlySet<string>,
): { summary: ExistingSummaryRecord; unchanged: boolean } | undefined => {
  const members = [...community.members].sort();
  const hasSameIdentity = (summary: ExistingSummaryRecord) =>
    !usedSummaryIds.has(summary.id) &&
    (summary.level ?? 0) === level &&
    summary.members?.length === members.length &&
    [...(summary.members ?? [])].sort().every((member, index) => member === members[index]);
  const matchingCommunity = existingSummaries.find((summary) =>
    hasSameIdentity(summary) && summary.contentFingerprint === contentFingerprint
  ) ?? existingSummaries.find(hasSameIdentity);

  if (!matchingCommunity) {
    return undefined;
  }

  return {
    summary: matchingCommunity,
    unchanged: matchingCommunity.contentFingerprint === contentFingerprint,
  };
};

export const persistCommunity = async (
  state: SummaryPersistenceState,
  community: Community,
  edgeRows: readonly CommunityEdgeRow[],
  claimRows: readonly CommunityClaimRow[],
  entityDescriptions: ReadonlyMap<string, string | null>,
  existingSummaries: readonly ExistingSummaryRecord[],
  namespace: string,
  embeddingModel: Embeddings,
  level = 0,
  childSummaries: ChildCommunitySummary[] = [],
): Promise<SummaryPersistenceState> => {
  const input = buildCommunityContextInput(community, edgeRows, claimRows, entityDescriptions);
  const { content: summaryContext, usesChildReports } = buildSummaryContext(input, childSummaries);
  const contentFingerprint = computeCommunityFingerprint(
    input,
    usesChildReports ? summaryContext : undefined,
  );
  const matched = findMatchingSummary(
    community,
    level,
    existingSummaries,
    contentFingerprint,
    state.usedSummaryIds,
  );

  if (matched?.unchanged) {
    const communitySummaries = new Map(state.communitySummaries);
    communitySummaries.set(community.id, {
      id: matched.summary.id,
      name: matched.summary.communityName,
      content: matched.summary.summaryContent ?? '',
    });
    const usedSummaryIds = new Set(state.usedSummaryIds);
    usedSummaryIds.add(matched.summary.id);

    return {
      ...state,
      communitySummaries,
      usedSummaryIds,
      reused: state.reused + 1,
    };
  }

  const saved = await saveCommunitySummary(
    community,
    summaryContext,
    contentFingerprint,
    namespace,
    embeddingModel,
    level,
    matched?.summary.id,
  );

  const communitySummaries = new Map(state.communitySummaries);
  communitySummaries.set(community.id, saved);
  const usedSummaryIds = new Set(state.usedSummaryIds);
  usedSummaryIds.add(saved.id);

  return {
    ...state,
    communitySummaries,
    usedSummaryIds,
    updated: state.updated + 1,
  };
};