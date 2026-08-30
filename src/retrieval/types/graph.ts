import type { Community, WeightedGraphEdge } from '../../build/detectCommunity';

export type EntityId = string;
export type CommunityId = string;

// 对应 schema 中的 RAGEntity（rag_entities）：id + name。别名/类型不在 schema 中，不在此建模。
export interface EntityRecord {
  id: EntityId;
  name: string;
}

// schema 中没有别名表，由调用方（service 层）以内存结构提供。
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

// “claim” 现来自真实表 RAGClaim（rag_claims）：entityIds 为实体名（subject/object 名称），
// text 为原文 description；sourceDocumentId/sourceChunkId 对应父块/子块溯源。
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
