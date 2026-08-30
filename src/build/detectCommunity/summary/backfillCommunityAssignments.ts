import { prismaClient } from '../../helper/prismaClient';
import type { CommunityClaimRow, CommunityEdgeRow } from '../types';

export const backfillCommunityAssignments = async (
  edgeRows: readonly CommunityEdgeRow[],
  claimRows: readonly CommunityClaimRow[],
  memberToCommunity: ReadonlyMap<string, number>,
  communitySummaries: ReadonlyMap<number, { id: string; name: string }>,
): Promise<void> => {
  for (const edge of edgeRows) {
    const communityId =
      memberToCommunity.get(edge.sourceEntity.name) ?? memberToCommunity.get(edge.targetEntity.name);
    const summary = communityId === undefined ? undefined : communitySummaries.get(communityId);

    if (summary) {
      await prismaClient.rAGGraphEdge.update({
        where: { id: edge.id },
        data: { communitySummaryId: summary.id },
      });
    }
  }

  for (const claim of claimRows) {
    const communityId = memberToCommunity.get(claim.subjectEntity.name);
    const summary = communityId === undefined ? undefined : communitySummaries.get(communityId);

    if (summary) {
      await prismaClient.rAGClaim.update({
        where: { id: claim.id },
        data: { communitySummaryId: summary.id },
      });
    }
  }
};
