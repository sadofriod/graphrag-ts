import { describe, expect, test } from 'bun:test';
import { createJudge } from './judge.ts';
import type { IntegrityStore } from './store.ts';
import type { PaperRecord, RetractionPath, RetractionRecord, SnapshotRecord } from './types.ts';

const paper: PaperRecord = { paper_id: 'Wtarget', doi: '10.1/target', title: 'Target', publication_year: 2000, venue: null, cited_by_count: 1, openalex_is_retracted: false, source_uri: 'https://openalex.example', source_tier: 'C', extraction_confidence: 1, fetched_at: '2025-01-01', reference_ids: ['Wroot'], reference_count: 1 };
const snapshot: SnapshotRecord = { id: 'snap-1', built_at: '2025-01-01', manifest: { snapshot_id: 'snap-1', built_at: '2025-01-01', seeds: [], counts: { papers: 2, cites: 1, retractions: 1, contexts: 0 }, sources: {}, params: {} } };
const status = (tier: RetractionRecord['source_tier'], is_retracted: boolean, source: RetractionRecord['source'] = tier === 'C' ? 'openalex' : 'crossref', paperId = 'Wroot'): RetractionRecord => ({ paper_id: paperId, doi: paperId === 'Wtarget' ? '10.1/target' : '10.1/root', source, source_tier: tier, is_retracted, source_uri: `https://${source}.example`, source_chunk_id: null, observed_at: '2025-01-01' });

const setup = (options: { readonly present?: boolean; readonly ratio?: number; readonly indexed?: boolean; readonly statuses?: readonly RetractionRecord[]; readonly ownStatuses?: readonly RetractionRecord[]; readonly context?: RetractionPath['edges'][number]['context_class']; readonly depth?: number } = {}) => {
  const target = options.present === false ? undefined : paper;
  const rootPaper = { ...paper, paper_id: 'Wroot', doi: '10.1/root', title: 'Root', publication_year: 1990, reference_ids: [], openalex_is_retracted: options.statuses?.some((item) => item.source === 'openalex' && item.is_retracted) ?? false };
  const edges = Array.from({ length: options.depth ?? 1 }, (_, index) => ({ citing_id: index === 0 ? 'Wtarget' : 'Wmid', cited_id: index === (options.depth ?? 1) - 1 ? 'Wroot' : 'Wmid', cited_doi: null, source_tier: 'C' as const, source_uri: `https://edge/${index}`, source_chunk_id: null, extraction_confidence: 1, ...(index === 0 && options.context !== undefined ? { context_class: options.context, context_source_tier: 'B' as const } : {}) }));
  const path: RetractionPath = { paper: rootPaper, edges, depth: edges.length, retractions: options.statuses ?? [] };
  const records = options.statuses ?? [];
  const ownRecords = options.ownStatuses ?? [];
  const acknowledgedEdge = { citing_id: 'Wtarget', cited_id: 'Wroot', cited_doi: null, source_tier: 'B' as const, source_uri: 'https://edge/ack', source_chunk_id: null, extraction_confidence: 1, context_class: options.context };
  const store = {
    activeSnapshot: async () => snapshot, findPaper: async () => target,
    coverage: async () => options.indexed === false
      ? { references: 0, resolved: 0, ratio: 0, indexed: false }
      : { references: 10, resolved: Math.round((options.ratio ?? 1) * 10), ratio: options.ratio ?? 1, indexed: true },
    pathsToRetracted: async () => records.some((item) => item.is_retracted) ? [path] : [],
    retractionStatuses: async (ids: readonly string[]) => {
      const result = new Map<string, readonly RetractionRecord[]>();
      for (const id of ids) {
        if (id === 'Wtarget') result.set(id, ownRecords);
        if (id === 'Wroot') result.set(id, records);
      }
      return result;
    },
    dependencyContext: async () => options.context === 'acknowledges_retraction' || options.context === 'critical' ? [acknowledgedEdge] : [],
    dependencyContexts: async () => options.context === 'acknowledges_retraction' || options.context === 'critical' ? [acknowledgedEdge] : [],
    recordJudgment: async () => undefined, recentJudgments: async () => [], loadSnapshot: async () => ({ snapshot_id: 'snap-1', papers: 0, cites: 0, retractions: 0 }),
  } as unknown as IntegrityStore;
  return createJudge(store);
};

describe('integrity judgment rules', () => {
  test('abstains for paper not in snapshot and low reference coverage in order', async () => {
    const missing = await setup({ present: false }).retractionPropagation({ paper_id: 'missing' });
    expect(missing.abstention_reason).toBe('paper_not_in_snapshot');
    expect(missing.target.source_tier).toBeNull();
    const low = await setup({ ratio: 0.49, statuses: [status('A', true)] }).retractionPropagation({ paper_id: 'Wtarget' });
    expect(low.abstention_reason).toBe('reference_coverage_below_threshold');
    expect(low).toMatchObject({ confidence: 0.245, confidence_basis: 'coverage' });
  });

  test('abstains on aggregator-only evidence and emits its flag', async () => {
    const result = await setup({ statuses: [status('C', true)] }).retractionPropagation({ paper_id: 'Wtarget' });
    expect(result).toMatchObject({ verdict: 'INSUFFICIENT_EVIDENCE', abstention_reason: 'single_aggregator_source', conflict_flags: [{ code: 'AGGREGATOR_ONLY_EVIDENCE' }] });
    expect(result).toMatchObject({ confidence: 0.5, confidence_basis: 'coverage' });
  });

  test('contested official evidence outranks depth and acknowledged evidence is supported', async () => {
    const contested = await setup({ statuses: [status('A', true)], context: 'supporting_evidence', depth: 2 }).retractionPropagation({ paper_id: 'Wtarget' });
    expect(contested.verdict).toBe('CONTESTED');
    expect(contested).toMatchObject({ confidence: 0.75, confidence_basis: 'retraction_evidence' });
    const supported = await setup({ statuses: [status('A', true)], context: 'critical' }).retractionPropagation({ paper_id: 'Wtarget' });
    expect(supported).toMatchObject({ verdict: 'SUPPORTED', dependence_acknowledged: true });
  });

  test('supports no-root cases and bounds confidence; audit includes computed evidence', async () => {
    const noRoot = await setup().retractionPropagation({ paper_id: 'Wtarget' });
    expect(noRoot.verdict).toBe('SUPPORTED');
    expect(noRoot).toMatchObject({ confidence: 1, confidence_basis: 'coverage' });
    expect(noRoot.confidence).toBeGreaterThanOrEqual(0);
    expect(noRoot.confidence).toBeLessThanOrEqual(1);
    const audit = await setup({ statuses: [status('A', true)], context: 'critical' }).evidenceAudit({ doi: '10.1/target' });
    const expectedDistribution = ([paper.source_tier, status('A', true).source_tier, 'C', 'B'] as const).reduce((counts, tier) => {
      counts[tier] += 1;
      return counts;
    }, { A: 0, B: 0, C: 0, D: 0 });
    expect(audit).toMatchObject({ evidence_path: [{ from: 'Wtarget', to: 'Wroot' }], tier_distribution: expectedDistribution, explain: expect.any(String) });
  });

  test('handles retraction of the target itself before ancestor roots', async () => {
    const ownOfficial = await setup({ ownStatuses: [status('A', true, 'crossref', 'Wtarget')] }).evidenceAudit({ paper_id: 'Wtarget' });
    expect(ownOfficial).toMatchObject({ verdict: 'CONTESTED', retracted_roots: [{ paper_id: 'Wtarget', depth: 0 }], evidence_path: [], explain: expect.stringMatching(/^Target is retracted \(A\):/) });
    expect(ownOfficial.retracted_roots[0]).not.toHaveProperty('dependence');

    const ownAggregator = await setup({ ownStatuses: [status('C', true, 'openalex', 'Wtarget')] }).retractionPropagation({ paper_id: 'Wtarget' });
    expect(ownAggregator).toMatchObject({ verdict: 'INSUFFICIENT_EVIDENCE', abstention_reason: 'single_aggregator_source' });
    expect(ownAggregator.conflict_flags.map((flag) => flag.code)).toContain('AGGREGATOR_ONLY_EVIDENCE');

    const ownAndAncestor = await setup({
      ownStatuses: [status('A', true, 'crossref', 'Wtarget')],
      statuses: [status('A', true)],
    }).evidenceAudit({ paper_id: 'Wtarget' });
    expect(ownAndAncestor.retracted_roots).toHaveLength(2);
    expect(ownAndAncestor.retracted_roots[0]).toMatchObject({ paper_id: 'Wtarget', depth: 0 });
    expect(ownAndAncestor.retracted_roots[1]).toMatchObject({ paper_id: 'Wroot', depth: 1 });
  });

  test('abstains when target references are not indexed and reports verdict confidence', async () => {
    const unindexed = await setup({ indexed: false }).evidenceAudit({ paper_id: 'Wtarget' });
    expect(unindexed).toMatchObject({
      verdict: 'INSUFFICIENT_EVIDENCE', abstention_reason: 'target_references_not_indexed',
      confidence: 0.25, confidence_basis: 'coverage', coverage: { references: 0, resolved: 0, ratio: 0, indexed: false },
    });
    expect(unindexed.explain).toContain('verdict confidence 0.250 (coverage)');

    const unindexedSelfRetraction = await setup({ indexed: false, ownStatuses: [status('A', true, 'crossref', 'Wtarget')] }).retractionPropagation({ paper_id: 'Wtarget' });
    expect(unindexedSelfRetraction).toMatchObject({ verdict: 'CONTESTED', confidence: 0.5, confidence_basis: 'retraction_evidence' });
  });

  test('adds the remaining conflict flags deterministically', async () => {
    const conflicted = await setup({ statuses: [status('A', true), status('A', false, 'retraction_watch')], ratio: 0.7 }).evidenceAudit({ paper_id: 'Wtarget' });
    expect(conflicted.conflict_flags.map((flag) => flag.code)).toContain('SOURCE_STATUS_CONFLICT');
    expect(conflicted.conflict_flags.map((flag) => flag.code)).toContain('AGGREGATOR_FALSE_NEGATIVE');
    expect(conflicted.conflict_flags.map((flag) => flag.code)).toContain('COVERAGE_GAP');
    const acknowledged = await setup({ context: 'acknowledges_retraction' }).evidenceAudit({ paper_id: 'Wtarget' });
    expect(acknowledged.conflict_flags.map((flag) => flag.code)).toContain('RETRACTION_ACKNOWLEDGED_NOT_PROPAGATED');
  });
});
