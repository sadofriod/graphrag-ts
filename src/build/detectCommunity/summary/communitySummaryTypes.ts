import type { CommunityClaimRow, CommunityEdgeRow } from '../types';

export interface ExistingSummaryRecord {
  id: string;
  communityName: string;
  contentFingerprint: string | null;
  summaryContent?: string;
  members?: string[];
  level?: number;
}

export interface LoadedGraphData {
  edgeRows: readonly CommunityEdgeRow[];
  claimRows: readonly CommunityClaimRow[];
  entityDescriptions: ReadonlyMap<string, string | null>;
  existingSummaries: readonly ExistingSummaryRecord[];
}

export interface SummaryAssignedItems {
  edgeCountBySummaryId: ReadonlyMap<string, number>;
  claimCountBySummaryId: ReadonlyMap<string, number>;
}

export interface SummaryPersistenceState {
  communitySummaries: ReadonlyMap<number, { id: string; name: string; content: string }>;
  usedSummaryIds: ReadonlySet<string>;
  reused: number;
  updated: number;
}