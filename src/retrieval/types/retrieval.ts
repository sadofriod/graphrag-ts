import type {
  ClaimRecord,
  CommunityEdge,
  CommunityId,
  CommunityRecord,
  EntityId,
  EvidenceSnippet,
} from './graph';

export interface QueryIntent {
  rawQuery: string;
  entities: string[];
  keywords: string[];
  themes: string[];
}

export interface MatchedEntity {
  entityId: EntityId;
  name: string;
  matchType: 'exact' | 'alias' | 'fuzzy' | 'semantic';
  score: number;
}

export interface RankedCommunity extends CommunityRecord {
  score: number;
  matchedEntities: string[];
}

export type CommunityHit = RankedCommunity;

export interface CommunityDetails extends CommunityRecord {
  memberEntities: string[];
  relatedEdges: CommunityEdge[];
  claims: ClaimRecord[];
  evidence: EvidenceSnippet[];
}

export interface EntityNeighborResult {
  entityName: string;
  depth: number;
  neighbors: Array<{
    entityId: EntityId;
    entityName: string;
    relationType?: string;
    weight: number;
  }>;
  communityIds: CommunityId[];
}

export interface RetrievalRequest {
  namespace: string;
  query: string;
  topK?: number;
  options?: {
    topK?: number;
    vectorChildTopK?: number;
    keywordSearchLimit?: number;
    evidenceChildLimit?: number;
    rrfK?: number;
    communityLevel?: number;
  };
}

export interface RetrievalResult {
  query: string;
  communities: CommunityHit[];
  evidence: EvidenceSnippet[];
  answer: string;
}

export interface GlobalRetrievalOptions {
  communityLevel?: number;
  mapTokenBudget?: number;
  reduceTokenBudget?: number;
  mapOutputReserve?: number;
  reduceOutputReserve?: number;
  mapConcurrency?: number;
}

export interface GlobalRetrievalRequest {
  namespace: string;
  query: string;
  options?: GlobalRetrievalOptions;
}

export interface GlobalMapAnswer {
  answer: string;
  usefulness: number;
  communityIds: CommunityId[];
}

export interface GlobalRetrievalResult {
  query: string;
  communityLevel: number;
  status: 'completed' | 'partial' | 'no_results';
  answer: string;
  selectedMapAnswers: GlobalMapAnswer[];
  failedMapBatches: number;
}
