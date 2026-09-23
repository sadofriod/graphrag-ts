import { prismaClient } from '../../helper/prismaClient';
import type { CommunityClaimRow, CommunityEdgeRow } from '../types';
import type { LoadedGraphData } from './communitySummaryTypes';

export const loadCommunitySummaryData = async (namespace: string): Promise<LoadedGraphData> => {
  const entityProfileClient = (prismaClient as unknown as {
    entityProfile?: {
      findMany: (args: {
        where: { namespace: string };
        select: { entityId: true; profile: true };
      }) => Promise<Array<{ entityId: string; profile: string | null }>>;
    };
  }).entityProfile;

  const [edgeRows, claimRows, entityRows, profileRows, summaryRows] = await Promise.all([
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
        select: { id: true, communityName: true, contentFingerprint: true },
      })
      : Promise.resolve([]),
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

  return {
    edgeRows: edgeRows as CommunityEdgeRow[],
    claimRows: claimRows as CommunityClaimRow[],
    entityDescriptions,
    existingSummaries: summaryRows ?? [],
  };
};