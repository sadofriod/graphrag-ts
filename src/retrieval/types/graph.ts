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
  level?: number;
  parentCommunityId?: string | null;
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
  /** First PDF page the supporting chunk came from. */
  page?: number;
  /** Last PDF page the supporting chunk spans; equals page for single-page chunks. */
  pageEnd?: number;
  /** Bounding box [x1, y1, x2, y2] of the first matched block on the page. */
  bbox?: [number, number, number, number];
  /** How the anchor was resolved: exact text match, fuzzy similarity, or unattributed. */
  anchorMethod?: 'exact' | 'fuzzy' | 'none';
}
