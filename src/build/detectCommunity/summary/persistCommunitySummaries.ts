import type { OpenAIEmbeddings } from '@langchain/openai';
import { Prisma } from '@prisma/client';

import { getCurrentNamespace } from '../../../namespace/namespaceContext';
import { prismaClient } from '../../helper/prismaClient';
import { modelLoaderSingleton } from '../../modelLoader';
import { backfillCommunityAssignments } from './backfillCommunityAssignments';
import { buildCommunityContext, getCommunityContextMaxTokens } from './buildCommunityContext';
import { buildCommunityContextInput } from './buildCommunityContextInput';
import { generateCommunitySummary } from './generateCommunitySummary';
import type { CommunityDetectionResult } from '../types';

export const persistCommunitySummaries = async (
  result: CommunityDetectionResult,
  namespace: string,
) => {
  const embeddingModel = modelLoaderSingleton.models?.embedding as OpenAIEmbeddings | undefined;

  if (!embeddingModel) {
    throw new Error('Embedding model is not loaded. Please check the configuration for the embedding model.');
  }

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
    prismaClient.entityProfile.findMany({ select: { entityId: true, profile: true } }),
  ]);

  const profileByEntityId = new Map(
    profileRows.map((profile) => [profile.entityId, profile.profile]),
  );

  // M6 (one-way read-only): [Node summaries] prefer EntityProfile (canonical
  // setting profiles); if unavailable, fall back to the description extracted
  // during build.
  const entityDescriptions = new Map(
    entityRows.map((entity) => [
      entity.name,
      profileByEntityId.get(entity.id) ?? entity.description,
    ]),
  );

  const memberToCommunity = new Map<string, number>();
  result.communities.forEach((community) => {
    community.members.forEach((member) => {
      memberToCommunity.set(member, community.id);
    });
  });

  const communitySummaries = new Map<number, { id: string; name: string }>();
  for (const community of result.communities) {
    const input = buildCommunityContextInput(community, edgeRows, claimRows, entityDescriptions);
    const inputContent = buildCommunityContext(input, {
      maxTokens: getCommunityContextMaxTokens(),
    });
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

    communitySummaries.set(community.id, { id: summary.id, name: communityName });
  }

  await backfillCommunityAssignments(edgeRows, claimRows, memberToCommunity, communitySummaries);
};
