import type { GraphEdge } from '../helper/buildEdges';

export interface Community<TId = number> {
  id: TId;
  members: string[];
}

export interface WeightedGraphEdge extends GraphEdge {
  weight?: number;
}

export type CommunityDetectionAlgorithm = 'leiden';

export interface CommunityDetectionResult {
  algorithm: CommunityDetectionAlgorithm;
  communities: Community[];
  membership: number[];
  score?: number;
}

/** Raw payload returned by the igraph wasm `leiden()` call. */
export interface LeidenResult {
  membership: number[];
  quality?: number;
  nb_clusters?: number;
  n_iterations_run?: number;
  qualities?: number[];
}

export interface CommunitySummaryResult {
  communityName: string;
  summaryContent: string;
}

export interface CommunityEdgeRow {
  id: string;
  sourceEntity: { name: string };
  targetEntity: { name: string };
  relationshipDesc: string;
}

export interface CommunityClaimRow {
  id: string;
  subjectEntity: { name: string };
  objectEntity: { name: string } | null;
  description: string;
}
