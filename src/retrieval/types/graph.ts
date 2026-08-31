import type { Community, WeightedGraphEdge } from '../../build/detectCommunity';

export type EntityId = string;
export type CommunityId = string;

// Represents RAGEntity (`rag_entities`) in the schema: id + name. Aliases/types are not present in the schema, so they are not modeled here.
export interface EntityRecord {
  id: EntityId;
  name: string;
}

// There is no alias table in the schema; callers (the service layer) provide aliases as in-memory structures.
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

// “claim” now comes from the real RAGClaim (`rag_claims`) table: entityIds hold entity names (subject/object names),
// text stores the original description; sourceDocumentId/sourceChunkId point back to the parent/child chunk provenance.
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
