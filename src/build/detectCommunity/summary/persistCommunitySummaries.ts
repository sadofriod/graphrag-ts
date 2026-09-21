import type { Embeddings } from '@langchain/core/embeddings';
import { Prisma } from '@prisma/client';

import { logger } from '../../../logger';
import { withNamespace } from '../../../namespace/namespaceContext';
import { prismaClient } from '../../helper/prismaClient';
import { modelLoaderSingleton } from '../../modelLoader';
import { backfillCommunityAssignments } from './backfillCommunityAssignments';
import { buildCommunityContext, getCommunityContextMaxTokens } from './buildCommunityContext';
import { buildCommunityContextInput } from './buildCommunityContextInput';
import { generateCommunitySummary } from './generateCommunitySummary';
import type {
  Community,
  CommunityClaimRow,
  CommunityDetectionResult,
  CommunityEdgeRow,
} from '../types';

export interface PersistSummaryResult {
  readonly total: number;
  readonly reused: number;
  readonly updated: number;
}

interface ExistingSummaryRecord {
  readonly id: string;
  readonly communityName: string;
}

interface LoadedGraphData {
  readonly edgeRows: readonly CommunityEdgeRow[];
  readonly claimRows: readonly CommunityClaimRow[];
  readonly entityDescriptions: ReadonlyMap<string, string | null>;
  readonly existingSummaries: readonly ExistingSummaryRecord[];
}

const loadGraphData = async (namespace: string): Promise<LoadedGraphData> => {
  const entityProfileClient = (prismaClient as unknown as {
    entityProfile?: {
      findMany: (args: {
        where: { namespace: string };
        select: { entityId: true; profile: true };
      }) => Promise<Array<{ entityId: string; profile: string | null }>>;
    };
  }).entityProfile;

  const [edgeRows, claimRows, entityRows, profileRows, summaryRows, detachedEdgeCount, detachedClaimCount] = await Promise.all([
    prismaClient.rAGGraphEdge.findMany({
      where: { namespace, parentId: { not: null } },
      orderBy: [{ sourceEntityId: 'asc' }, { targetEntityId: 'asc' }],
      include: {
        sourceEntity: { select: { name: true } },
        targetEntity: { select: { name: true } },
      },
    }),
    prismaClient.rAGClaim.findMany({
      where: { namespace, sourceParentId: { not: null } },
      include: {
        subjectEntity: { select: { name: true } },
        objectEntity: { select: { name: true } },
      },
    }),
    prismaClient.rAGEntity.findMany({ where: { namespace }, select: { id: true, name: true, description: true } }),
    entityProfileClient?.findMany({ where: { namespace }, select: { entityId: true, profile: true } }) ?? Promise.resolve([]),
    prismaClient.rAGCommunitySummary.findMany
      ? prismaClient.rAGCommunitySummary.findMany({
        where: { namespace },
        select: { id: true, communityName: true },
      })
      : Promise.resolve([]),
    prismaClient.rAGGraphEdge.count({ where: { namespace, parentId: null } }),
    prismaClient.rAGClaim.count({ where: { namespace, sourceParentId: null } }),
  ]);

  if (detachedEdgeCount > 0 || detachedClaimCount > 0) {
    logger.warn(
      { namespace, detachedEdgeCount, detachedClaimCount },
      'Detached graph rows were found and excluded from community summary generation.',
    );
  }

  const profileByEntityId = new Map(
    profileRows.map((profile) => [profile.entityId, profile.profile]),
  );

  const entityDescriptions = new Map(
    entityRows.map((entity) => [
      entity.name,
      profileByEntityId.get(entity.id) ?? entity.description,
    ]),
  );

  return {
    edgeRows: edgeRows as CommunityEdgeRow[],
    claimRows: claimRows as CommunityClaimRow[],
    entityDescriptions,
    existingSummaries: (summaryRows ?? []) as ExistingSummaryRecord[],
  };
};

const saveCommunitySummary = async (
  community: Community,
  inputContent: string,
  namespace: string,
  embeddingModel: Embeddings,
): Promise<{ id: string; name: string }> => {
  const { communityName, summaryContent } = await generateCommunitySummary(community, inputContent);
  const summary = await prismaClient.rAGCommunitySummary.create({
    data: {
      namespace,
      communityName,
      summaryContent,
    },
  });

  const summaryEmbedding = await embeddingModel.embedQuery(summaryContent);
  await prismaClient.$executeRaw(Prisma.sql`
    UPDATE "rag_community_summaries"
    SET "summary_embedding" = CAST(${JSON.stringify(summaryEmbedding)} AS vector)
    WHERE "id" = ${summary.id}
      AND "namespace" = ${namespace}
  `);

  return { id: summary.id, name: communityName };
};

const buildMemberToCommunityMap = (communities: readonly Community[]): Map<string, number> => {
  const map = new Map<string, number>();
  for (const community of communities) {
    for (const member of community.members) {
      map.set(member, community.id);
    }
  }
  return map;
};

interface SummaryAssignedItems {
  readonly edgeCountBySummaryId: ReadonlyMap<string, number>;
  readonly claimCountBySummaryId: ReadonlyMap<string, number>;
}

const computeSummaryAssignedCounts = (
  edgeRows: readonly CommunityEdgeRow[],
  claimRows: readonly CommunityClaimRow[],
): SummaryAssignedItems => {
  const edgeCount = new Map<string, number>();
  for (const edge of edgeRows) {
    if (edge.communitySummaryId) {
      edgeCount.set(edge.communitySummaryId, (edgeCount.get(edge.communitySummaryId) ?? 0) + 1);
    }
  }

  const claimCount = new Map<string, number>();
  for (const claim of claimRows) {
    if (claim.communitySummaryId) {
      claimCount.set(claim.communitySummaryId, (claimCount.get(claim.communitySummaryId) ?? 0) + 1);
    }
  }

  return { edgeCountBySummaryId: edgeCount, claimCountBySummaryId: claimCount };
};

const findMatchingSummary = (
  community: Community,
  edgeRows: readonly CommunityEdgeRow[],
  claimRows: readonly CommunityClaimRow[],
  existingSummaries: readonly ExistingSummaryRecord[],
  assignedCounts: SummaryAssignedItems,
): ExistingSummaryRecord | undefined => {
  const memberSet = new Set(community.members);
  const commEdges = edgeRows.filter(
    (e) => memberSet.has(e.sourceEntity.name) || memberSet.has(e.targetEntity.name),
  );
  const commClaims = claimRows.filter(
    (c) =>
      memberSet.has(c.subjectEntity.name) ||
      (c.objectEntity ? memberSet.has(c.objectEntity.name) : false),
  );

  if (commEdges.length === 0 && commClaims.length === 0) {
    return undefined;
  }

  for (const summary of existingSummaries) {
    const isEdgeMatch =
      commEdges.length === (assignedCounts.edgeCountBySummaryId.get(summary.id) ?? 0) &&
      commEdges.every((e) => e.communitySummaryId === summary.id);

    const isClaimMatch =
      commClaims.length === (assignedCounts.claimCountBySummaryId.get(summary.id) ?? 0) &&
      commClaims.every((c) => c.communitySummaryId === summary.id);

    if (isEdgeMatch && isClaimMatch) {
      return summary;
    }
  }

  return undefined;
};

export const persistCommunitySummaries = async (
  result: CommunityDetectionResult,
  namespace: string,
): Promise<PersistSummaryResult> =>
  withNamespace(namespace, async () => {
    const embeddingModel = modelLoaderSingleton.models?.embedding as Embeddings | undefined;
    if (!embeddingModel) {
      throw new Error('Embedding model is not loaded. Please check the configuration for the embedding model.');
    }

    const { edgeRows, claimRows, entityDescriptions, existingSummaries } = await loadGraphData(namespace);
    const assignedCounts = computeSummaryAssignedCounts(edgeRows, claimRows);
    const memberToCommunity = buildMemberToCommunityMap(result.communities);
    const communitySummaries = new Map<number, { id: string; name: string }>();
    const usedSummaryIds = new Set<string>();

    let reused = 0;
    let updated = 0;

    for (const community of result.communities) {
      const matched = findMatchingSummary(
        community,
        edgeRows,
        claimRows,
        existingSummaries,
        assignedCounts,
      );

      if (matched) {
        reused += 1;
        communitySummaries.set(community.id, { id: matched.id, name: matched.communityName });
        usedSummaryIds.add(matched.id);
        continue;
      }

      updated += 1;
      const input = buildCommunityContextInput(community, edgeRows, claimRows, entityDescriptions);
      const inputContent = buildCommunityContext(input, {
        maxTokens: getCommunityContextMaxTokens(),
      });
      const saved = await saveCommunitySummary(community, inputContent, namespace, embeddingModel);
      communitySummaries.set(community.id, saved);
      usedSummaryIds.add(saved.id);
    }

    const staleSummaryIds = existingSummaries
      .filter((s) => !usedSummaryIds.has(s.id))
      .map((s) => s.id);

    if (staleSummaryIds.length > 0 && prismaClient.rAGCommunitySummary.deleteMany) {
      await prismaClient.rAGCommunitySummary.deleteMany({
        where: { id: { in: staleSummaryIds }, namespace },
      });
    }

    await backfillCommunityAssignments(edgeRows, claimRows, memberToCommunity, communitySummaries);

    return { total: result.communities.length, reused, updated };
  });
