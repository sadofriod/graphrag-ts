import type { CommunityContextInput } from './buildCommunityContext';
import type { Community, CommunityClaimRow, CommunityEdgeRow } from '../types';

export const buildCommunityContextInput = (
  community: Community,
  edgeRows: readonly CommunityEdgeRow[],
  claimRows: readonly CommunityClaimRow[],
  entityDescriptions: ReadonlyMap<string, string | null>,
): CommunityContextInput => {
  const memberSet = new Set(community.members);

  const communityEdges = edgeRows
    .filter(
      (edge) => memberSet.has(edge.sourceEntity.name) || memberSet.has(edge.targetEntity.name),
    )
    .map((edge) => ({
      source: edge.sourceEntity.name,
      target: edge.targetEntity.name,
      relationshipDesc: edge.relationshipDesc,
    }));

  const communityClaims = claimRows
    .filter(
      (claim) =>
        memberSet.has(claim.subjectEntity.name) ||
        (claim.objectEntity ? memberSet.has(claim.objectEntity.name) : false),
    )
    .map((claim) => ({
      subject: claim.subjectEntity.name,
      ...(claim.objectEntity ? { object: claim.objectEntity.name } : {}),
      description: claim.description,
    }));

  return {
    members: community.members,
    entities: community.members.map((name) => {
      const description = entityDescriptions.get(name);
      return description ? { name, description } : { name };
    }),
    edges: communityEdges,
    claims: communityClaims,
  };
};
