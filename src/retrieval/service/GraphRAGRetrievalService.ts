import { prismaClient } from '../../build/helper/prismaClient';
import { logger } from '../../logger';
import { generateAnswer } from '../answer/answerGenerator';
import { embedText } from '../entity/embedding';
import { matchEntitiesWithSemantic } from '../entity/entityMatcher';
import { fetchCommunityDetails, getEntityNeighbors } from '../evidence/evidenceRetriever';
import { parseQuery } from '../query/queryParser';
import { rankCommunities } from '../ranking/communityRanker';
import { recallCommunitiesByTopology } from '../recall/communityResolver';
import {
  buildKeywordTerms,
  mergeChildChunks,
  searchChildChunksByKeywords,
} from '../recall/keywordSearch';
import {
  searchSimilarChildChunks,
  searchSimilarCommunitySummaries,
} from '../recall/vectorSearch';
import { selectFinalCommunities } from '../selection/finalSelector';
import type {
  ClaimRecord,
  CommunityEdge,
  CommunityId,
  CommunityMember,
  CommunityRecord,
  EntityRecord,
} from '../types/graph';
import type {
  CommunityDetails,
  EntityNeighborResult,
  MatchedEntity,
  RetrievalRequest,
  RetrievalResult,
} from '../types/retrieval';

interface LoadedEdge {
  id: string;
  parentId: string | null;
  source: string;
  target: string;
  relationType: string;
  weight: number;
  communityId: string | null;
}

import { getRetrievalDefaults } from '../../config/defaults';

/** Default retrieval tuning values (can be overridden per-request or via injectGraphRAG). */
const GLOBAL_RETRIEVAL_DEFAULTS = getRetrievalDefaults();

const loadEntities = async (): Promise<EntityRecord[]> => {
  const rows = await prismaClient.rAGEntity.findMany({ select: { id: true, name: true } });
  return rows.map((row) => ({ id: row.id, name: row.name }));
};

const loadEdges = async (): Promise<LoadedEdge[]> => {
  const rows = await prismaClient.rAGGraphEdge.findMany({
    include: {
      sourceEntity: { select: { name: true } },
      targetEntity: { select: { name: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    parentId: row.parentId,
    source: row.sourceEntity.name,
    target: row.targetEntity.name,
    relationType: row.relationshipDesc,
    weight: row.weight,
    communityId: row.communitySummaryId,
  }));
};

const loadCommunities = async (
  ids: readonly CommunityId[],
  edges: readonly LoadedEdge[],
): Promise<CommunityRecord[]> => {
  const rows = await prismaClient.rAGCommunitySummary.findMany({
    where: { id: { in: [...ids] } },
  });

  const membersByCommunity = new Map<CommunityId, Set<string>>();
  for (const edge of edges) {
    if (!edge.communityId) {
      continue;
    }
    const members = membersByCommunity.get(edge.communityId) ?? new Set<string>();
    members.add(edge.source);
    members.add(edge.target);
    membersByCommunity.set(edge.communityId, members);
  }

  return rows.map((row) => ({
    id: row.id,
    name: row.communityName,
    summary: row.summaryContent,
    members: [...(membersByCommunity.get(row.id) ?? [])],
  }));
};

const toCommunityEdges = (edges: readonly LoadedEdge[]): CommunityEdge[] =>
  edges.map((edge) => ({
    source: edge.source,
    target: edge.target,
    communityId: edge.communityId ?? '',
    relationType: edge.relationType,
    weight: edge.weight,
  }));

const loadClaims = async (): Promise<ClaimRecord[]> => {
  const rows = await prismaClient.rAGClaim.findMany({
    include: {
      subjectEntity: { select: { name: true } },
      objectEntity: { select: { name: true } },
    },
  });

  if (rows.length === 0) {
    logger.warn('No claims found for this namespace; run a rebuild to populate rag_claims.');
  }

  return rows.map((row) => ({
    id: row.id,
    entityIds: [row.subjectEntity.name, ...(row.objectEntity ? [row.objectEntity.name] : [])],
    text: row.description,
    ...(row.sourceParentId ? { sourceDocumentId: row.sourceParentId } : {}),
    ...(row.sourceChunkId ? { sourceChunkId: row.sourceChunkId } : {}),
  }));
};

const toCommunityMembers = (edges: readonly LoadedEdge[]): CommunityMember[] => {
  const members: CommunityMember[] = [];
  for (const edge of edges) {
    if (!edge.communityId) {
      continue;
    }
    members.push({ communityId: edge.communityId, entityId: edge.source });
    members.push({ communityId: edge.communityId, entityId: edge.target });
  }
  return members;
};

const fuseMatchedWithIntent = (
  matched: readonly MatchedEntity[],
  intentEntities: readonly string[],
  entities: readonly EntityRecord[],
): MatchedEntity[] => {
  const byName = new Map<string, MatchedEntity>(matched.map((item) => [item.name, item]));

  for (const name of intentEntities) {
    const entity = entities.find((item) => item.name === name);
    if (entity && !byName.has(entity.name)) {
      byName.set(entity.name, {
        entityId: entity.id,
        name: entity.name,
        matchType: 'exact',
        score: 1,
      });
    }
  }

  return Array.from(byName.values());
};

export class GraphRAGRetrievalService {
  async retrieve(request: RetrievalRequest): Promise<RetrievalResult> {
    const { query } = request;
    const topK = request.topK ?? request.options?.topK ?? GLOBAL_RETRIEVAL_DEFAULTS.topK ?? 5;

    const vectorChildTopK =
      request.options?.vectorChildTopK ?? GLOBAL_RETRIEVAL_DEFAULTS.vectorChildTopK ?? 8;
    const keywordSearchLimit =
      request.options?.keywordSearchLimit ?? GLOBAL_RETRIEVAL_DEFAULTS.keywordSearchLimit ?? 16;
    const evidenceChildLimit =
      request.options?.evidenceChildLimit ?? GLOBAL_RETRIEVAL_DEFAULTS.evidenceChildLimit ?? 20;
    const rrfK = request.options?.rrfK ?? GLOBAL_RETRIEVAL_DEFAULTS.rrfK ?? 60;

    const [entities, loadedEdges, claims] = await Promise.all([
      loadEntities(),
      loadEdges(),
      loadClaims(),
    ]);

    const intent = await parseQuery(query);
    const matchedByQuery = await matchEntitiesWithSemantic(query, entities, [], undefined, rrfK);
    const matched = fuseMatchedWithIntent(matchedByQuery, intent.entities, entities);

    const { communityIds } = await recallCommunitiesByTopology(
      matched.map((item) => item.name),
      2,
    );

    const queryEmbedding = await embedText(query);
    const semanticRankings = (await searchSimilarCommunitySummaries(queryEmbedding, topK)).map(
      (hit) => hit.id,
    );

    const childChunks = mergeChildChunks(
      await searchSimilarChildChunks(queryEmbedding, vectorChildTopK),
      await searchChildChunksByKeywords(
        buildKeywordTerms({
          intentEntities: intent.entities,
          intentKeywords: intent.keywords,
          matched,
        }),
        keywordSearchLimit,
      ),
      evidenceChildLimit,
    );

    const candidateIds = Array.from(new Set([...communityIds, ...semanticRankings]));
    const communities = await loadCommunities(candidateIds, loadedEdges);
    const edges = toCommunityEdges(loadedEdges);

    const ranked = rankCommunities(
      candidateIds,
      communities,
      edges,
      matched.map((item) => item.name),
      semanticRankings,
      topK,
      rrfK,
    );
    const selected = await selectFinalCommunities(query, ranked, true);

    const evidence = [
      ...selected.flatMap((community) =>
        fetchCommunityDetails(community.id, communities, edges, claims).evidence,
      ),
      ...childChunks.map((chunk) => ({
        text: chunk.content,
        sourceChunkId: chunk.id,
      })),
    ];

    const answer = await generateAnswer(
      query,
      selected.map((community) => community.summary ?? ''),
      evidence,
    );

    return { query, communities: selected, evidence, answer };
  }

  async getCommunityDetails(communityId: CommunityId): Promise<CommunityDetails> {
    const [loadedEdges, claims] = await Promise.all([loadEdges(), loadClaims()]);
    const communities = await loadCommunities([communityId], loadedEdges);
    const edges = toCommunityEdges(loadedEdges);

    return fetchCommunityDetails(communityId, communities, edges, claims);
  }

  async getEntityNeighbors(entityName: string, depth = 1): Promise<EntityNeighborResult> {
    const [entities, loadedEdges] = await Promise.all([loadEntities(), loadEdges()]);
    const edges = toCommunityEdges(loadedEdges);
    const communityMembers = toCommunityMembers(loadedEdges);

    return getEntityNeighbors(entityName, entities, edges, communityMembers, depth);
  }
}
