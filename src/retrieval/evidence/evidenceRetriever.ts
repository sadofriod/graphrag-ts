import { expandNeighbors } from '../recall/graphExpander';
import type {
  ClaimRecord,
  CommunityEdge,
  CommunityId,
  CommunityMember,
  CommunityRecord,
  EntityRecord,
  EvidenceSnippet,
} from '../types/graph';
import type { CommunityDetails, EntityNeighborResult } from '../types/retrieval';

export function fetchEvidenceForCommunity(
  members: ReadonlySet<string>,
  claims: readonly ClaimRecord[],
): EvidenceSnippet[] {
  return claims
    .filter((claim) => claim.entityIds.some((entityId) => members.has(entityId)))
    .map((claim) => ({
      claimId: claim.id,
      text: claim.text,
      ...(claim.sourceDocumentId ? { sourceDocumentId: claim.sourceDocumentId } : {}),
      ...(claim.sourceChunkId ? { sourceChunkId: claim.sourceChunkId } : {}),
    }));
}

export function fetchCommunityDetails(
  communityId: CommunityId,
  communities: readonly CommunityRecord[],
  edges: readonly CommunityEdge[],
  claims: readonly ClaimRecord[],
): CommunityDetails {
  const community = communities.find((item) => item.id === communityId);
  if (!community) {
    throw new Error(`Community not found: ${communityId}`);
  }

  const members = new Set(community.members);
  const relatedEdges = edges.filter((edge) => edge.communityId === communityId);
  const communityClaims = claims.filter((claim) =>
    claim.entityIds.some((entityId) => members.has(entityId)),
  );

  return {
    ...community,
    memberEntities: community.members,
    relatedEdges,
    claims: communityClaims,
    evidence: fetchEvidenceForCommunity(members, claims),
  };
}

export function getEntityNeighbors(
  entityName: string,
  entities: readonly EntityRecord[],
  edges: readonly CommunityEdge[],
  communityMembers: readonly CommunityMember[],
  depth = 1,
): EntityNeighborResult {
  const entityIdByName = new Map(entities.map((entity) => [entity.name, entity.id]));
  const neighborNames = expandNeighbors([entityName], edges, depth);

  const neighbors = neighborNames.map((name) => {
    const connectingEdge = edges.find(
      (edge) =>
        (edge.source === entityName && edge.target === name) ||
        (edge.source === name && edge.target === entityName),
    );

    return {
      entityId: entityIdByName.get(name) ?? name,
      entityName: name,
      weight: connectingEdge?.weight ?? 1,
      ...(connectingEdge?.relationType ? { relationType: connectingEdge.relationType } : {}),
    };
  });

  const communityIds = communityMembers
    .filter((member) => member.entityId === entityName)
    .map((member) => member.communityId);

  return { entityName, depth, neighbors, communityIds };
}
