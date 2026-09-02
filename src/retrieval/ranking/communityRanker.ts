import type { WeightedGraphEdge } from '../../build/detectCommunity';
import type { CommunityId, CommunityRecord } from '../types/graph';
import type { RankedCommunity } from '../types/retrieval';
import { computeEdgeWeight } from '../utils/scoring';
import { reciprocalRankFusion } from '../utils/rrf';

export function computeEntityOverlap(
  queryEntities: readonly string[],
  communityEntityNames: readonly string[],
): number {
  const querySet = new Set(queryEntities);
  const communitySet = new Set(communityEntityNames);

  let intersection = 0;
  for (const name of querySet) {
    if (communitySet.has(name)) {
      intersection += 1;
    }
  }

  const union = querySet.size + communitySet.size - intersection;
  if (union === 0) {
    return 0;
  }

  return intersection / union;
}

export function computeStructuralScore(
  queryEntities: readonly string[],
  communityEntityNames: readonly string[],
  edges: readonly WeightedGraphEdge[],
): number {
  let score = 0;

  for (const query of queryEntities) {
    for (const member of communityEntityNames) {
      score += computeEdgeWeight(query, member, edges);
    }
  }

  return score;
}

const communityById = (
  communities: readonly CommunityRecord[],
): Map<CommunityId, CommunityRecord> => new Map(communities.map((community) => [community.id, community]));

const rankByOverlap = (
  candidateCommunityIds: readonly CommunityId[],
  communities: readonly CommunityRecord[],
  matchedEntities: readonly string[],
): CommunityId[] => {
  const byId = communityById(communities);

  return [...candidateCommunityIds].sort((a, b) => {
    const overlapA = computeEntityOverlap(matchedEntities, byId.get(a)?.members ?? []);
    const overlapB = computeEntityOverlap(matchedEntities, byId.get(b)?.members ?? []);

    return overlapB - overlapA;
  });
};

const rankByStructure = (
  candidateCommunityIds: readonly CommunityId[],
  communities: readonly CommunityRecord[],
  edges: readonly WeightedGraphEdge[],
  matchedEntities: readonly string[],
): CommunityId[] => {
  const byId = communityById(communities);

  return [...candidateCommunityIds].sort((a, b) => {
    const structureA = computeStructuralScore(matchedEntities, byId.get(a)?.members ?? [], edges);
    const structureB = computeStructuralScore(matchedEntities, byId.get(b)?.members ?? [], edges);

    return structureB - structureA;
  });
};

export function rankCommunitiesWithRRF(
  semanticRankings: readonly CommunityId[],
  entityOverlapRankings: readonly CommunityId[],
  structuralRankings: readonly CommunityId[],
  communities: readonly CommunityRecord[],
  matchedEntities: readonly string[],
  k = 60,
  topK?: number,
): RankedCommunity[] {
  const fused = reciprocalRankFusion(
    [semanticRankings, entityOverlapRankings, structuralRankings].map((list) =>
      list.map((id) => ({ id })),
    ),
    ({ id }) => id,
    k,
  );

  const byId = communityById(communities);

  const ranked = fused
    .map(({ item, score }) => {
      const community = byId.get(item.id);
      if (!community) {
        return undefined;
      }

      return {
        ...community,
        score,
        matchedEntities: [...matchedEntities],
      };
    })
    .filter((community): community is RankedCommunity => community !== undefined);

  return topK === undefined ? ranked : ranked.slice(0, topK);
}

export function rankCommunities(
  candidateCommunityIds: readonly CommunityId[],
  communities: readonly CommunityRecord[],
  edges: readonly WeightedGraphEdge[],
  matchedEntities: readonly string[],
  semanticRankings?: readonly CommunityId[],
  topK?: number,
  rrfK: number = 60,
): RankedCommunity[] {
  const overlapRankings = rankByOverlap(candidateCommunityIds, communities, matchedEntities);
  const structuralRankings = rankByStructure(candidateCommunityIds, communities, edges, matchedEntities);

  return rankCommunitiesWithRRF(
    semanticRankings ?? [],
    overlapRankings,
    structuralRankings,
    communities,
    matchedEntities,
    rrfK,
    topK,
  );
}
