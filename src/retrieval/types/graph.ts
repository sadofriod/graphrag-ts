import type { Community, WeightedGraphEdge } from '../../build/detectCommunity';

export type EntityId = string;
export type CommunityId = string;

export interface EntityRecord {
  id: EntityId;
  name: string;
}

export interface EntityAlias {
  entityId: EntityId;
  alias: string;
}

export interface CommunityEdge extends WeightedGraphEdge {
  communityId: CommunityId;
  relationType?: string;
}

export interface CommunityRecord extends Community<string> {
  name?: string;
  summary?: string;
}

export interface CommunityMember {
  communityId: CommunityId;
  entityId: EntityId;
}

export interface ClaimRecord {
  id: string;
  entityIds: EntityId[];
  text: string;
  sourceDocumentId?: string;
  sourceChunkId?: string;
}

export interface EvidenceSnippet {
  claimId?: string;
  text: string;
  sourceDocumentId?: string;
  sourceChunkId?: string;
}
