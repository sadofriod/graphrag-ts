import type { Embeddings } from '@langchain/core/embeddings';
import { Prisma } from '@prisma/client';

import { prismaClient } from '../../helper/prismaClient';
import { generateCommunitySummary } from './generateCommunitySummary';
import type { Community } from '../types';

export const saveCommunitySummary = async (
  community: Community,
  inputContent: string,
  contentFingerprint: string,
  namespace: string,
  embeddingModel: Embeddings,
): Promise<{ id: string; name: string }> => {
  const { communityName, summaryContent } = await generateCommunitySummary(community, inputContent);
  const summary = await prismaClient.rAGCommunitySummary.create({
    data: { namespace, communityName, summaryContent, contentFingerprint },
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