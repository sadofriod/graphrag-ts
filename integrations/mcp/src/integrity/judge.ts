import { agreementLabel, contextFactor, detectConflicts, evidenceWeight } from './tier.ts';
import type { ContextClass, ConflictFlag, EvidencePathItem, JudgmentPayload, PaperRecord, PaperRetractionStatus, RetractionPath, RetractionRecord, SourceTier } from './types.ts';
import type { IntegrityStore } from './store.ts';

export type PaperRef = { readonly doi?: string; readonly paper_id?: string };
type ResolvedRef = { readonly paper?: PaperRecord; readonly snapshot?: Awaited<ReturnType<IntegrityStore['activeSnapshot']>> };
type RootData = { readonly path: RetractionPath; readonly statuses: readonly RetractionRecord[]; readonly allStatuses: readonly RetractionRecord[]; readonly acknowledged: boolean; readonly rootContext: { readonly context_class: ContextClass; readonly snippet: string | null; readonly tier: SourceTier | null; readonly uri: string | null } };

const resolveRef = async (store: IntegrityStore, ref: PaperRef): Promise<ResolvedRef> => {
  const snapshot = await store.activeSnapshot();
  if (!snapshot) return {};
  const paper = await store.findPaper({ ...(ref.doi === undefined ? {} : { doi: ref.doi }), ...(ref.paper_id === undefined ? {} : { paperId: ref.paper_id }) });
  return { snapshot, ...(paper === undefined ? {} : { paper }) };
};

const classOf = (context: ContextClass | undefined): ContextClass => context ?? 'unknown';
const isAcknowledging = (context: ContextClass | undefined): boolean => contextFactor(context) === 1;
const emptyCoverage = { references: 0, resolved: 0, ratio: 0, indexed: false };
const isoTimestamp = (value: Date | string): string => new Date(value).toISOString();

const targetShape = (paper: PaperRecord) => ({ paper_id: paper.paper_id, doi: paper.doi, title: paper.title, year: paper.publication_year, source_tier: paper.source_tier });

const rootData = (path: RetractionPath, statuses: readonly RetractionRecord[]): RootData => {
  // The target's reliance on the path begins at its first outgoing citation edge.
  const first = path.edges[0];
  const context = first?.context_class;
  const acknowledged = isAcknowledging(context);
  return {
    path, allStatuses: statuses, statuses: statuses.filter((record) => record.is_retracted), acknowledged,
    rootContext: { context_class: classOf(context), snippet: first?.context_snippet ?? null,
      tier: first?.context_source_tier ?? null, uri: first?.context_source_uri ?? null },
  };
};

const targetRoot = (paper: PaperRecord, statuses: readonly RetractionRecord[]): RootData => ({
  path: { paper, edges: [], depth: 0, retractions: statuses },
  statuses,
  allStatuses: statuses,
  acknowledged: false,
  rootContext: { context_class: 'unknown', snippet: null, tier: null, uri: null },
});

const rootsFor = async (store: IntegrityStore, paths: readonly RetractionPath[]): Promise<RootData[]> => {
  const ids = paths.map((path) => path.paper?.paper_id).filter((id): id is string => id !== undefined);
  const statuses = await store.retractionStatuses(ids);
  return paths.flatMap((path) => {
    const id = path.paper?.paper_id;
    if (!id) return [];
    const records = statuses.get(id) ?? path.retractions;
    const asserting = records.filter((record) => record.is_retracted);
    return asserting.length === 0 ? [] : [rootData(path, records)];
  });
};

const rootPayload = (root: RootData) => {
  const asserting = root.statuses.filter((record) => record.is_retracted);
  const sourceTiers = asserting.map((record) => record.source_tier);
  const weight = evidenceWeight(asserting);
  return {
    ...rootIdentifiers(root.path.paper, asserting[0]),
    title: root.path.paper?.title ?? null, year: root.path.paper?.publication_year ?? null, depth: root.path.depth,
    status: rootStatuses(asserting),
    weight, agreement: agreementLabel(sourceTiers),
    ...(root.path.edges.length === 0 ? {} : { dependence: root.rootContext }),
    dependence_acknowledged: root.acknowledged,
  };
};

const rootIdentifiers = (paper: PaperRecord | null | undefined, asserting?: RetractionRecord) => ({
  paper_id: paper?.paper_id ?? asserting?.paper_id ?? '',
  doi: paper?.doi ?? asserting?.doi ?? null,
});

const rootStatuses = (asserting: readonly RetractionRecord[]) => asserting.map((record) => ({
  source: record.source, tier: record.source_tier, is_retracted: record.is_retracted,
  retraction_date: record.retraction_date ?? null, uri: record.source_uri,
}));

const paperStatuses = (records: readonly RetractionRecord[]): PaperRetractionStatus[] => records.map((record) => ({
  paper_id: record.paper_id, doi: record.doi, source: record.source, source_tier: record.source_tier,
  is_retracted: record.is_retracted, retraction_date: record.retraction_date ?? null,
  source_uri: record.source_uri, source_chunk_id: record.source_chunk_id, observed_at: record.observed_at,
}));

const buildPaperStatus = (paper: PaperRecord, records: readonly RetractionRecord[]) => ({
  paper: targetShape(paper), statuses: paperStatuses(records),
});

const collectConflicts = (roots: readonly RootData[], coverage: JudgmentPayload['coverage'], targetId: string): ConflictFlag[] => {
  const conflicts = roots.flatMap((root) => detectConflicts(root.allStatuses, {
    ...(root.path.paper === null ? {} : { openAlexFlag: root.path.paper.openalex_is_retracted }),
    contexts: root.path.edges.map((edge) => edge.context_class ?? null),
  }));
  if (coverage.indexed && coverage.ratio < 0.8) conflicts.push({ code: 'COVERAGE_GAP', paper_id: targetId, detail: 'Reference resolution coverage is below 0.8.' });
  return conflicts;
};

const confidenceFor = (verdict: JudgmentPayload['verdict'], roots: readonly RootData[], coverage: JudgmentPayload['coverage']): number => {
  const strongest = roots.reduce((best, root) => Math.max(best, evidenceWeight(root.statuses) * (root.path.depth <= 1 ? 1 : 0.75)), 0);
  const value = verdict === 'CONTESTED'
    ? Math.min(1, strongest) * (coverage.indexed ? 0.5 + 0.5 * coverage.ratio : 0.5)
    : verdict === 'SUPPORTED'
      ? coverage.indexed ? 0.5 + 0.5 * coverage.ratio : 0.25
      : coverage.indexed ? 0.5 * coverage.ratio : 0.25;
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
};

const verdictFor = (roots: readonly RootData[], coverage: JudgmentPayload['coverage']): { verdict: JudgmentPayload['verdict']; reason: JudgmentPayload['abstention_reason'] } => {
  if (coverage.indexed && coverage.ratio < 0.5) return { verdict: 'INSUFFICIENT_EVIDENCE', reason: 'reference_coverage_below_threshold' };
  if (roots.some((root) => root.statuses.length > 0 && root.statuses.every((status) => status.source_tier === 'C'))) {
    return { verdict: 'INSUFFICIENT_EVIDENCE', reason: 'single_aggregator_source' };
  }
  if (roots.some((root) => root.statuses.some((status) => status.source_tier === 'A') && !root.acknowledged)) {
    return { verdict: 'CONTESTED', reason: null };
  }
  if (roots.length > 0 && roots.every((root) => root.acknowledged)) return { verdict: 'SUPPORTED', reason: null };
  if (roots.length === 0 && !coverage.indexed) return { verdict: 'INSUFFICIENT_EVIDENCE', reason: 'target_references_not_indexed' };
  if (roots.length === 0) return { verdict: 'SUPPORTED', reason: null };
  return { verdict: 'CONTESTED', reason: null };
};

const evidencePath = (roots: readonly RootData[]): EvidencePathItem[] => roots.flatMap((root) => {
  let from = root.path.edges[0]?.citing_id ?? '';
  return root.path.edges.map((edge, index) => {
    const item = { from, to: edge.cited_id, depth: index + 1, edge: { kind: 'CITES' as const, tier: edge.source_tier, uri: edge.source_uri, context_class: edge.context_class ?? null } };
    from = edge.cited_id;
    return item;
  });
});

const tierDistribution = (roots: readonly RootData[]): Readonly<Record<SourceTier, number>> => {
  const result: Record<SourceTier, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const root of roots) {
    if (root.path.paper) result[root.path.paper.source_tier] += 1;
    for (const status of root.allStatuses) result[status.source_tier] += 1;
    for (const edge of root.path.edges) {
      result[edge.source_tier] += 1;
      if (edge.context_source_tier) result[edge.context_source_tier] += 1;
    }
  }
  return result;
};

const explainPayload = (payload: Omit<JudgmentPayload, 'explain'>): string => {
  const roots = payload.retracted_roots.length;
  const codes = payload.conflict_flags.map((flag) => flag.code).sort().join(', ') || 'none';
  const selfRoot = payload.retracted_roots.find((root) => root.depth === 0);
  const prefix = selfRoot ? `Target is retracted (${selfRoot.agreement}): ` : `${payload.verdict}: `;
  return `${prefix}${roots} retracted root(s); reference coverage ${payload.coverage.resolved}/${payload.coverage.references} (${payload.coverage.ratio.toFixed(2)}); verdict confidence ${payload.confidence.toFixed(3)} (${payload.confidence_basis}); conflicts: ${codes}${payload.abstention_reason ? `; abstention: ${payload.abstention_reason}` : ''}.`;
};

const makeJudgment = async (store: IntegrityStore, ref: PaperRef, audit: boolean): Promise<JudgmentPayload> => {
  const resolved = await resolveRef(store, ref);
  const snapshot = resolved.snapshot;
  if (!snapshot) throw new Error('No active integrity snapshot is available.');
  if (!resolved.paper) {
    const payload: JudgmentPayload = { snapshot: { id: snapshot.id, built_at: isoTimestamp(snapshot.built_at) }, target: { paper_id: ref.paper_id ?? '', doi: ref.doi ?? null, title: null, year: null, source_tier: null }, verdict: 'INSUFFICIENT_EVIDENCE', confidence: confidenceFor('INSUFFICIENT_EVIDENCE', [], emptyCoverage), confidence_basis: 'coverage', retracted_roots: [], conflict_flags: [], coverage: emptyCoverage, abstention_reason: 'paper_not_in_snapshot' };
    await store.recordJudgment({ snapshotId: snapshot.id, paperId: null, inputRef: ref.doi ?? ref.paper_id ?? '', judgmentType: audit ? 'evidence_audit' : 'retraction_propagation', payload });
    return audit ? { ...payload, evidence_path: [], tier_distribution: { A: 0, B: 0, C: 0, D: 0 }, explain: explainPayload(payload) } : payload;
  }
  return buildPresentJudgment(store, ref, audit, snapshot, resolved.paper);
};

const chooseVerdict = (
  ownAsserting: readonly RetractionRecord[],
  selfRoot: RootData | undefined,
  ancestorRoots: readonly RootData[],
  coverage: JudgmentPayload['coverage'],
): { verdict: JudgmentPayload['verdict']; reason: JudgmentPayload['abstention_reason'] } => {
  if (ownAsserting.some((status) => status.source_tier === 'A')) return { verdict: 'CONTESTED', reason: null };
  if (ownAsserting.length > 0 && ownAsserting.every((status) => status.source_tier === 'C')) {
    return { verdict: 'INSUFFICIENT_EVIDENCE', reason: 'single_aggregator_source' };
  }
  if (selfRoot) return { verdict: 'CONTESTED', reason: null };
  return verdictFor(ancestorRoots, coverage);
};

const targetRetraction = async (store: IntegrityStore, paper: PaperRecord): Promise<{ readonly asserting: readonly RetractionRecord[]; readonly root?: RootData }> => {
  const statuses = await store.retractionStatuses([paper.paper_id]);
  const records = statuses.get(paper.paper_id) ?? [];
  const asserting = records.filter((status) => status.is_retracted);
  return { asserting, ...(asserting.length === 0 ? {} : { root: targetRoot(paper, records) }) };
};

const buildPresentJudgment = async (store: IntegrityStore, ref: PaperRef, audit: boolean, snapshot: NonNullable<ResolvedRef['snapshot']>, paper: PaperRecord): Promise<JudgmentPayload> => {
  const coverage = await store.coverage(paper.paper_id);
  const targetStatus = await targetRetraction(store, paper);
  const { asserting: ownAsserting, root: selfRoot } = targetStatus;
  const paths = await store.pathsToRetracted(paper.paper_id, 2);
  const ancestorRoots = await rootsFor(store, paths);
  const roots = [...(selfRoot ? [selfRoot] : []), ...ancestorRoots];
  const conflicts = await collectJudgmentConflicts(store, paper, roots, coverage);
  const decision = chooseVerdict(ownAsserting, selfRoot, ancestorRoots, coverage);
  const confidenceBasis = decision.verdict === 'CONTESTED' ? 'retraction_evidence' : 'coverage';
  const base = {
    snapshot: { id: snapshot.id, built_at: isoTimestamp(snapshot.built_at) }, target: targetShape(paper), verdict: decision.verdict,
    confidence: confidenceFor(decision.verdict, roots, coverage), confidence_basis: confidenceBasis,
    retracted_roots: roots.map(rootPayload), conflict_flags: conflicts,
    coverage, abstention_reason: decision.reason,
    ...(roots.length > 0 && roots.every((root) => root.acknowledged) ? { dependence_acknowledged: true } : {}),
  } satisfies Omit<JudgmentPayload, 'evidence_path' | 'tier_distribution' | 'explain'>;
  const payload: JudgmentPayload = audit ? { ...base, evidence_path: evidencePath(roots), tier_distribution: tierDistribution(roots), explain: explainPayload(base) } : base;
  await store.recordJudgment({ snapshotId: snapshot.id, paperId: paper.paper_id, inputRef: ref.doi ?? ref.paper_id ?? paper.paper_id, judgmentType: audit ? 'evidence_audit' : 'retraction_propagation', payload });
  return payload;
};

const collectJudgmentConflicts = async (store: IntegrityStore, paper: PaperRecord, roots: readonly RootData[], coverage: JudgmentPayload['coverage']): Promise<ConflictFlag[]> => {
  const conflicts = collectConflicts(roots, coverage, paper.paper_id);
  const acknowledged = (await store.dependencyContexts(paper.paper_id)).filter((edge) => isAcknowledging(edge.context_class));
  if (acknowledged.length === 0) return conflicts;
  const statuses = await store.retractionStatuses([...new Set(acknowledged.map((edge) => edge.cited_id))]);
  for (const edge of acknowledged) {
    if (!(statuses.get(edge.cited_id) ?? []).some((record) => record.is_retracted)
      && !conflicts.some((flag) => flag.code === 'RETRACTION_ACKNOWLEDGED_NOT_PROPAGATED' && flag.paper_id === edge.cited_id)) {
      conflicts.push({ code: 'RETRACTION_ACKNOWLEDGED_NOT_PROPAGATED', paper_id: edge.cited_id, detail: 'A citation acknowledges retraction but no retraction status was propagated.' });
    }
  }
  return conflicts;
};

export const createJudge = (store: IntegrityStore) => ({
  paperStatus: async (ref: PaperRef) => {
    const resolved = await resolveRef(store, ref);
    if (!resolved.snapshot) throw new Error('No active integrity snapshot is available.');
    if (!resolved.paper) return { paper: null, statuses: [], abstention_reason: 'paper_not_in_snapshot' as const };
    const statuses = await store.retractionStatuses([resolved.paper.paper_id]);
    return buildPaperStatus(resolved.paper, statuses.get(resolved.paper.paper_id) ?? []);
  },
  retractionPropagation: (ref: PaperRef) => makeJudgment(store, ref, false),
  evidenceAudit: (ref: PaperRef) => makeJudgment(store, ref, true),
});

export type Judge = ReturnType<typeof createJudge>;
