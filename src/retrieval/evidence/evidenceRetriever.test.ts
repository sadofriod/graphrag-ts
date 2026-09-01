import { describe, expect, it } from 'bun:test';

import type { ClaimRecord, CommunityEdge, CommunityMember, CommunityRecord, EntityRecord } from '../types/graph';
import {
  fetchCommunityDetails,
  fetchEvidenceForCommunity,
  getEntityNeighbors,
} from './evidenceRetriever';

const communities: CommunityRecord[] = [
  { id: 'c1', members: ['A', 'B'], summary: 'Community One Summary' },
  { id: 'c2', members: ['X', 'Y'], summary: 'Community Two Summary' },
];

const edges: CommunityEdge[] = [
  { source: 'A', target: 'B', communityId: 'c1', relationType: 'partnership', weight: 2 },
  { source: 'B', target: 'C', communityId: 'c1', weight: 1 },
  { source: 'X', target: 'Y', communityId: 'c2', weight: 1 },
];

const claims: ClaimRecord[] = [
  { id: 'cl1', entityIds: ['A', 'B'], text: 'A works with B', sourceDocumentId: 'd1', sourceChunkId: 'ch1' },
  { id: 'cl2', entityIds: ['X', 'Y'], text: 'X is unrelated to Y', sourceDocumentId: 'd2' },
];

const entities: EntityRecord[] = [
  { id: 'eA', name: 'A' },
  { id: 'eB', name: 'B' },
  { id: 'eX', name: 'X' },
];

const communityMembers: CommunityMember[] = [
  { communityId: 'c1', entityId: 'A' },
  { communityId: 'c1', entityId: 'B' },
  { communityId: 'c2', entityId: 'X' },
];

describe('fetchCommunityDetails', () => {
  it('aggregates members, edges, claims and evidence for a community', () => {
    const details = fetchCommunityDetails('c1', communities, edges, claims);

    expect(details.id).toBe('c1');
    expect(details.memberEntities).toEqual(['A', 'B']);
    expect(details.summary).toBe('Community One Summary');
    expect(details.relatedEdges.map((edge) => edge.source)).toEqual(['A', 'B']);
    expect(details.claims.map((claim) => claim.id)).toEqual(['cl1']);
    expect(details.evidence).toEqual([
      { claimId: 'cl1', text: 'A works with B', sourceDocumentId: 'd1', sourceChunkId: 'ch1' },
    ]);
  });

  it('throws when the community does not exist', () => {
    expect(() => fetchCommunityDetails('missing', communities, edges, claims)).toThrow();
  });
});

describe('fetchEvidenceForCommunity', () => {
  it('maps claims into evidence snippets for matching members', () => {
    expect(fetchEvidenceForCommunity(new Set(['A', 'B']), [claims[0]!])).toEqual([
      { claimId: 'cl1', text: 'A works with B', sourceDocumentId: 'd1', sourceChunkId: 'ch1' },
    ]);
  });

  it('drops claims that reference no member of the community', () => {
    expect(fetchEvidenceForCommunity(new Set(['A']), claims)).toEqual([
      { claimId: 'cl1', text: 'A works with B', sourceDocumentId: 'd1', sourceChunkId: 'ch1' },
    ]);
    expect(fetchEvidenceForCommunity(new Set(['X']), claims)).toEqual([
      { claimId: 'cl2', text: 'X is unrelated to Y', sourceDocumentId: 'd2' },
    ]);
  });
});

describe('getEntityNeighbors', () => {
  it('returns direct neighbors with edge weight and community ids', () => {
    const result = getEntityNeighbors('A', entities, edges, communityMembers, 1);

    expect(result.entityName).toBe('A');
    expect(result.depth).toBe(1);
    expect(result.neighbors).toEqual([
      { entityId: 'eB', entityName: 'B', relationType: 'partnership', weight: 2 },
    ]);
    expect(result.communityIds).toEqual(['c1']);
  });
});
