import { describe, expect, it } from 'bun:test';

import { prismaClient } from '../../helper/prismaClient';
import { backfillCommunityAssignments } from './backfillCommunityAssignments';
import type { CommunityClaimRow, CommunityEdgeRow } from '../types';

describe('backfillCommunityAssignments', () => {
  it('writes communitySummaryId onto edges and claims in the matching community', async () => {
    const edgeRows: CommunityEdgeRow[] = [
      { id: 'edge-ab', sourceEntity: { name: 'A' }, targetEntity: { name: 'B' }, relationshipDesc: 'x' },
      { id: 'edge-de', sourceEntity: { name: 'D' }, targetEntity: { name: 'E' }, relationshipDesc: 'x' },
    ];
    const claimRows: CommunityClaimRow[] = [
      { id: 'claim-1', subjectEntity: { name: 'A' }, objectEntity: null, description: 'd' },
    ];

    const memberToCommunity = new Map([
      ['A', 0],
      ['B', 0],
      ['D', 1],
    ]);
    const communitySummaries = new Map([
      [0, { id: 'summary-0', name: 's0' }],
      [1, { id: 'summary-1', name: 's1' }],
    ]);

    const originalEdgeUpdate = prismaClient.rAGGraphEdge.update;
    const originalClaimUpdate = prismaClient.rAGClaim.update;
    const edgeUpdates: unknown[] = [];
    const claimUpdates: unknown[] = [];

    prismaClient.rAGGraphEdge.update = ((args: unknown) => {
      edgeUpdates.push(args);
      return Promise.resolve({ id: (args as { where: { id: string } }).where.id }) as never;
    }) as typeof prismaClient.rAGGraphEdge.update;
    prismaClient.rAGClaim.update = ((args: unknown) => {
      claimUpdates.push(args);
      return Promise.resolve({ id: (args as { where: { id: string } }).where.id }) as never;
    }) as typeof prismaClient.rAGClaim.update;

    try {
      await backfillCommunityAssignments(edgeRows, claimRows, memberToCommunity, communitySummaries);

      expect(edgeUpdates).toEqual([
        { where: { id: 'edge-ab' }, data: { communitySummaryId: 'summary-0' } },
        { where: { id: 'edge-de' }, data: { communitySummaryId: 'summary-1' } },
      ]);
      expect(claimUpdates).toEqual([
        { where: { id: 'claim-1' }, data: { communitySummaryId: 'summary-0' } },
      ]);
    } finally {
      prismaClient.rAGGraphEdge.update = originalEdgeUpdate;
      prismaClient.rAGClaim.update = originalClaimUpdate;
    }
  });

  it('skips edges and claims without a resolved community', async () => {
    const edgeRows: CommunityEdgeRow[] = [
      { id: 'edge-xy', sourceEntity: { name: 'X' }, targetEntity: { name: 'Y' }, relationshipDesc: 'x' },
    ];
    const claimRows: CommunityClaimRow[] = [
      { id: 'claim-x', subjectEntity: { name: 'X' }, objectEntity: null, description: 'd' },
    ];

    const originalEdgeUpdate = prismaClient.rAGGraphEdge.update;
    const originalClaimUpdate = prismaClient.rAGClaim.update;

    prismaClient.rAGGraphEdge.update = (() => {
      throw new Error('should not be called');
    }) as never;
    prismaClient.rAGClaim.update = (() => {
      throw new Error('should not be called');
    }) as never;

    try {
      await backfillCommunityAssignments(edgeRows, claimRows, new Map(), new Map());
    } finally {
      prismaClient.rAGGraphEdge.update = originalEdgeUpdate;
      prismaClient.rAGClaim.update = originalClaimUpdate;
    }
  });
});
