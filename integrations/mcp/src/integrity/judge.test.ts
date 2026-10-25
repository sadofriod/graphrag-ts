import { describe, expect, test } from 'bun:test';
import { createJudge } from './judge.ts';
import type { IntegrityStore } from './store.ts';
import type { PaperRecord, RetractionPath, RetractionRecord, SnapshotRecord } from './types.ts';

const paper: PaperRecord = { paper_id: 'Wtarget', doi: '10.1/target', title: 'Target', publication_year: 2000, venue: null, cited_by_count: 1, openalex_is_retracted: false, source_uri: 'https://openalex.example', source_tier: 'C', extraction_confidence: 1, fetched_at: '2025-01-01', reference_ids: ['Wroot'], reference_count: 1 };
const snapshot: SnapshotRecord = { id: 'snap-1', built_at: '2025-01-01', manifest: { snapshot_id: 'snap-1', built_at: '2025-01-01', seeds: [], counts: { papers: 2, cites: 1, retractions: 1, contexts: 0 }, sources: {}, params: {} } };
const status = (tier: RetractionRecord['source_tier'], is_retracted: boolean, source: RetractionRecord['source'] = tier === 'C' ? 'openalex' : 'crossref'): RetractionRecord => ({ paper_id: 'Wroot', doi: '10.1/root', source, source_tier: tier, is_retracted, source_uri: `https://${source}.example`, source_chunk_id: null, observed_at: '2025-01-01' });

const setup = (options: { readonly present?: boolean; readonly ratio?: number; readonly statuses?: readonly RetractionRecord[]; readonly context?: RetractionPath['edges'][number]['context_class']; readonly depth?: number } = {}) => {
  const target = options.present === false ? undefined : paper;
  const rootPaper = { ...paper, paper_id: 'Wroot', doi: '10.1/root', title: 'Root', publication_year: 1990, reference_ids: [], openalex_is_retracted: options.statuses?.some((item) => item.source === 'openalex' && item.is_retracted) ?? false };
  const edges = Array.from({ length: options.depth ?? 1 }, (_, index) => ({ citing_id: index === 0 ? 'Wtarget' : 'Wmid', cited_id: index === (options.depth ?? 1) - 1 ? 'Wroot' : 'Wmid', cited_doi: null, source_tier: 'C' as const, source_uri: `https://edge/${index}`, source_chunk_id: null, extraction_confidence: 1, ...(index === 0 && options.context !== undefined ? { context_class: options.context, context_source_tier: 'B' as const } : {}) }));
  const path: RetractionPath = { paper: rootPaper, edges, depth: edges.length, retractions: options.statuses ?? [] };
  const records = options.statuses ?? [];
  const acknowledgedEdge = { citing_id: 'Wtarget', cited_id: 'Wroot', cited_doi: null, source_tier: 'B' as const, source_uri: 'https://edge/ack', source_chunk_id: null, extraction_confidence: 1, context_class: options.context };
  const store = {
    activeSnapshot: async () => snapshot, findPaper: async () => target,
    coverage: async () => ({ references: 10, resolved: Math.round((options.ratio ?? 1) * 10), ratio: options.ratio ?? 1 }),
    pathsToRetracted: async () => records.some((item) => item.is_retracted) ? [path] : [],
    retractionStatuses: async () => new Map([['Wroot', records]]),
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
  });

  test('abstains on aggregator-only evidence and emits its flag', async () => {
    const result = await setup({ statuses: [status('C', true)] }).retractionPropagation({ paper_id: 'Wtarget' });
    expect(result).toMatchObject({ verdict: 'INSUFFICIENT_EVIDENCE', abstention_reason: 'single_aggregator_source', conflict_flags: [{ code: 'AGGREGATOR_ONLY_EVIDENCE' }] });
  });

  test('contested official evidence outranks depth and acknowledged evidence is supported', async () => {
    const contested = await setup({ statuses: [status('A', true)], context: 'supporting_evidence', depth: 2 }).retractionPropagation({ paper_id: 'Wtarget' });
    expect(contested.verdict).toBe('CONTESTED');
    const supported = await setup({ statuses: [status('A', true)], context: 'critical' }).retractionPropagation({ paper_id: 'Wtarget' });
    expect(supported).toMatchObject({ verdict: 'SUPPORTED', dependence_acknowledged: true });
  });

  test('supports no-root cases and bounds confidence; audit includes computed evidence', async () => {
    const noRoot = await setup().retractionPropagation({ paper_id: 'Wtarget' });
    expect(noRoot.verdict).toBe('SUPPORTED');
    expect(noRoot.confidence).toBeGreaterThanOrEqual(0);
    expect(noRoot.confidence).toBeLessThanOrEqual(1);
    const audit = await setup({ statuses: [status('A', true)], context: 'critical' }).evidenceAudit({ doi: '10.1/target' });
    const expectedDistribution = ([paper.source_tier, status('A', true).source_tier, 'C', 'B'] as const).reduce((counts, tier) => {
      counts[tier] += 1;
      return counts;
    }, { A: 0, B: 0, C: 0, D: 0 });
    expect(audit).toMatchObject({ evidence_path: [{ from: 'Wtarget', to: 'Wroot' }], tier_distribution: expectedDistribution, explain: expect.any(String) });
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
