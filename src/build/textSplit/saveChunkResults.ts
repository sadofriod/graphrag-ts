import type { Embeddings } from '@langchain/core/embeddings';
import { buildChildInsertSql } from '../helper/buildChildInsertSql';
import { prismaClient } from '../helper/prismaClient';
import type { ChunkResult, SplitResult } from './types';

export const saveChunkResults = async (
  results: ChunkResult[],
  embeddingModel: Embeddings,
  namespace: string,
  title?: string,
): Promise<SplitResult[]> =>
  Promise.all(
    results.map((chunk) =>
      prismaClient.$transaction(async (tx) => {
        const parent = await tx.rAGParent.create({
          data: {
            namespace,
            content: chunk.parentContent,
            ...(title ? { title } : {}),
          },
        });

        const createdChildren = await Promise.all(
          chunk.childChunks.map(async (childContent) => ({
            parentId: parent.id,
            content: childContent,
            embedding: await embeddingModel.embedQuery(childContent),
          })),
        );
        const result: SplitResult = {
          parentId: parent.id,
          childIds: [],
          edges: chunk.edges,
          claims: chunk.claims,
          entities: chunk.entities,
        };
        if (createdChildren.length > 0) {
          const inserted = await tx.$queryRaw<{ id: string }[]>(
            buildChildInsertSql(createdChildren, namespace),
          );
          result.childIds = inserted.map((row) => row.id);
        }
        return result;
      }),
    ),
  );
