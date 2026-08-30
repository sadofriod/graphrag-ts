import { Prisma } from '@prisma/client';

import { prismaClient } from '../../build/helper/prismaClient';
import { getCurrentNamespace } from '../../namespace/namespaceContext';
import type { CommunityId } from '../types/graph';

export interface CommunityRecall {
  communityIds: CommunityId[];
  expandedEntityIds: string[];
}

export async function recallCommunitiesByTopology(
  seedEntityNames: readonly string[],
  maxHop = 2,
): Promise<CommunityRecall> {
  if (seedEntityNames.length === 0) {
    return { communityIds: [], expandedEntityIds: [] };
  }

  const rows = await prismaClient.$queryRaw<Array<{ community_id: string | null; entity_id: string }>>(
    Prisma.sql`
      WITH RECURSIVE reachable(entity_id, hop) AS (
        SELECT "id", 0
        FROM "rag_entities"
        WHERE "name" IN (${Prisma.join(seedEntityNames)})
          AND "namespace" = ${getCurrentNamespace()}
        UNION
        SELECT
          CASE WHEN e."source_entity_id" = r.entity_id THEN e."target_entity_id" ELSE e."source_entity_id" END,
          r.hop + 1
        FROM "rag_graph_edges" e
        JOIN reachable r ON e."source_entity_id" = r.entity_id OR e."target_entity_id" = r.entity_id
        WHERE r.hop < ${maxHop}
          AND e."namespace" = ${getCurrentNamespace()}
      ),
      hits AS (
        SELECT e."community_summary_id" AS community_id, r.entity_id
        FROM "rag_graph_edges" e
        JOIN reachable r ON r.entity_id = e."source_entity_id" OR r.entity_id = e."target_entity_id"
        WHERE e."community_summary_id" IS NOT NULL
          AND e."namespace" = ${getCurrentNamespace()}
      )
      SELECT DISTINCT hits.community_id, hits.entity_id
      FROM hits
      ORDER BY hits.community_id
    `,
  );

  const communityIds = Array.from(
    new Set(rows.map((row) => row.community_id).filter((id): id is string => id !== null)),
  );
  const expandedEntityIds = Array.from(new Set(rows.map((row) => row.entity_id)));

  return { communityIds, expandedEntityIds };
}
