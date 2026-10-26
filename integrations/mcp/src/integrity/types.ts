export type SourceTier = 'A' | 'B' | 'C' | 'D';
export const TIER_WEIGHT: Readonly<Record<SourceTier, number>> = { A: 1, B: 0.6, C: 0.3, D: 0 };

export type ContextClass = 'acknowledges_retraction' | 'critical' | 'supporting_evidence' | 'neutral' | 'unknown';

export type PaperRecord = {
  readonly paper_id: string; readonly doi: string | null; readonly title: string | null;
  readonly publication_year: number | null; readonly venue: string | null; readonly cited_by_count: number | null;
  readonly openalex_is_retracted: boolean; readonly source_uri: string; readonly source_tier: SourceTier;
  readonly extraction_confidence: number; readonly fetched_at: string | Date;
  readonly reference_ids: readonly string[]; readonly reference_count: number;
};

export type CiteEdge = {
  readonly citing_id: string; readonly cited_id: string; readonly cited_doi: string | null;
  readonly source_tier: SourceTier; readonly source_uri: string; readonly source_chunk_id: string | null;
  readonly extraction_confidence: number; readonly context_snippet?: string; readonly context_class?: ContextClass;
  readonly context_source_tier?: SourceTier; readonly context_source_uri?: string;
};

export type RetractionRecord = {
  readonly paper_id: string; readonly doi: string | null; readonly source: 'crossref' | 'retraction_watch' | 'openalex';
  readonly source_tier: SourceTier; readonly is_retracted: boolean; readonly retraction_date?: string | null;
  readonly source_uri: string; readonly source_chunk_id: string | null; readonly observed_at: string | Date;
};

export type PaperRetractionStatus = {
  readonly paper_id: string; readonly doi: string | null; readonly source: RetractionRecord['source'];
  readonly source_tier: SourceTier; readonly is_retracted: boolean; readonly retraction_date: string | null;
  readonly source_uri: string; readonly source_chunk_id: string | null; readonly observed_at: string | Date;
};

export type SnapshotManifest = {
  readonly snapshot_id: string; readonly built_at: string; readonly seeds: readonly string[];
  readonly counts: { readonly papers: number; readonly cites: number; readonly retractions: number; readonly contexts: number };
  readonly sources: Readonly<Record<string, unknown>>; readonly params: Readonly<Record<string, unknown>>;
};

export type AbstentionReason = 'paper_not_in_snapshot' | 'reference_coverage_below_threshold' | 'single_aggregator_source' | 'target_references_not_indexed';

export type JudgmentPayload = {
  readonly snapshot: { readonly id: string; readonly built_at: string };
  readonly target: { readonly paper_id: string; readonly doi: string | null; readonly title: string | null; readonly year: number | null; readonly source_tier: SourceTier | null };
  readonly verdict: 'CONTESTED' | 'SUPPORTED' | 'INSUFFICIENT_EVIDENCE'; readonly confidence: number;
  readonly confidence_basis: 'retraction_evidence' | 'coverage';
  readonly retracted_roots: readonly RetractionRoot[]; readonly conflict_flags: readonly ConflictFlag[];
  readonly coverage: { readonly references: number; readonly resolved: number; readonly ratio: number; readonly indexed: boolean };
  readonly abstention_reason: AbstentionReason | null; readonly dependence_acknowledged?: boolean;
  readonly evidence_path?: readonly EvidencePathItem[]; readonly tier_distribution?: Readonly<Record<SourceTier, number>>;
  readonly explain?: string;
};

export type RetractionRoot = {
  readonly paper_id: string; readonly doi: string | null; readonly title: string | null; readonly year: number | null;
  readonly depth: number; readonly status: readonly RetractionEvidenceStatus[]; readonly weight: number;
  readonly agreement: string; readonly dependence?: { readonly context_class: ContextClass; readonly snippet: string | null; readonly tier: SourceTier | null; readonly uri: string | null };
  readonly dependence_acknowledged?: boolean;
};

export type RetractionEvidenceStatus = {
  readonly source: RetractionRecord['source']; readonly tier: SourceTier; readonly is_retracted: boolean;
  readonly retraction_date: string | null; readonly uri: string;
};

export type ConflictCode = 'SOURCE_STATUS_CONFLICT' | 'AGGREGATOR_FALSE_NEGATIVE' | 'AGGREGATOR_ONLY_EVIDENCE' | 'RETRACTION_ACKNOWLEDGED_NOT_PROPAGATED' | 'COVERAGE_GAP';
export type ConflictFlag = { readonly code: ConflictCode; readonly paper_id: string; readonly detail: string };
export type EvidencePathItem = { readonly from: string; readonly to: string; readonly depth: number; readonly edge: { readonly kind: 'CITES'; readonly tier: SourceTier; readonly uri: string; readonly context_class: ContextClass | null } };

export type SnapshotRecord = { readonly id: string; readonly built_at: string | Date; readonly manifest: SnapshotManifest };
export type CoverageRecord = { readonly references: number; readonly resolved: number; readonly ratio: number; readonly indexed: boolean };
export type RetractionPath = { readonly paper: PaperRecord | null; readonly edges: readonly CiteEdge[]; readonly depth: number; readonly retractions: readonly RetractionRecord[] };
