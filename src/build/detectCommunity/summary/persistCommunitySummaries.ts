import type { Embeddings } from '@langchain/core/embeddings';
import { Prisma } from '@prisma/client';

import { getCurrentNamespace } from '../../../namespace/namespaceContext';
import { prismaClient } from '../../helper/prismaClient';
import { modelLoaderSingleton } from '../../modelLoader';
import { backfillCommunityAssignments } from './backfillCommunityAssignments';
import { buildCommunityContext, getCommunityContextMaxTokens } from './buildCommunityContext';
import { buildCommunityContextInput } from './buildCommunityContextInput';
import { generateCommunitySummary } from './generateCommunitySummary';
import type { Community, CommunityDetectionResult } from '../types';

const loadGraphData = async () => {
  const entityProfileClient = (prismaClient as unknown as {
    entityProfile?: {
      findMany: (args: {
        select: { entityId: true; profile: true };
      }) => Promise<Array<{ entityId: string; profile: string | null }>>;
    };
  }).entityProfile;

  const [edgeRows, claimRows, entityRows, profileRows] = await Promise.all([
    prismaClient.rAGGraphEdge.findMany({
      orderBy: [{ sourceEntityId: 'asc' }, { targetEntityId: 'asc' }],
      include: {
        sourceEntity: { select: { name: true } },
        targetEntity: { select: { name: true } },
      },
    }),
    prismaClient.rAGClaim.findMany({
      include: {
        subjectEntity: { select: { name: true } },
        objectEntity: { select: { name: true } },
      },
    }),
    prismaClient.rAGEntity.findMany({ select: { id: true, name: true, description: true } }),
    entityProfileClient?.findMany({ select: { entityId: true, profile: true } }) ?? Promise.resolve([]),
  ]);

  const profileByEntityId = new Map(
    profileRows.map((profile) => [profile.entityId, profile.profile]),
  );

  const entityDescriptions = new Map(
    entityRows.map((entity) => [
      entity.name,
      profileByEntityId.get(entity.id) ?? entity.description,
    ]),
  );

  return { edgeRows, claimRows, entityDescriptions };
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
      AND "namespace" = ${getCurrentNamespace()}
  `);

  return { id: summary.id, name: communityName };
};

const buildMemberToCommunityMap = (communities: Community[]): Map<string, number> => {
  const map = new Map<string, number>();
  for (const community of communities) {
    for (const member of community.members) {
      map.set(member, community.id);
    }
  }
  return map;
};

export const persistCommunitySummaries = async (
  result: CommunityDetectionResult,
  namespace: string,
) => {
  const embeddingModel = modelLoaderSingleton.models?.embedding as Embeddings | undefined;
  if (!embeddingModel) {
    throw new Error('Embedding model is not loaded. Please check the configuration for the embedding model.');
  }

  const { edgeRows, claimRows, entityDescriptions } = await loadGraphData();
  const memberToCommunity = buildMemberToCommunityMap(result.communities);
  const communitySummaries = new Map<number, { id: string; name: string }>();

  for (const community of result.communities) {
    const input = buildCommunityContextInput(community, edgeRows, claimRows, entityDescriptions);
    const inputContent = buildCommunityContext(input, {
      maxTokens: getCommunityContextMaxTokens(),
    });
    const saved = await saveCommunitySummary(community, inputContent, namespace, embeddingModel);
    communitySummaries.set(community.id, saved);
  }

  await backfillCommunityAssignments(edgeRows, claimRows, memberToCommunity, communitySummaries);
};
