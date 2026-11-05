import { describe, expect, test } from 'bun:test';
import { extractDoi, runReferenceBatch } from './batch.ts';
import type { Judge } from './judge.ts';

describe('reference batch', () => {
  test('extracts DOI from a bare value, doi prefix, citation, and trailing punctuation', () => {
    expect(extractDoi('10.1016/S0140-6736(97)11096-0')).toBe('10.1016/S0140-6736(97)11096-0');
    expect(extractDoi('doi:10.1016/S0140-6736(97)11096-0')).toBe('10.1016/S0140-6736(97)11096-0');
    expect(extractDoi('See https://doi.org/10.1016/S0140-6736(97)11096-0.,)]')).toBe('10.1016/S0140-6736(97)11096-0');
    expect(extractDoi('A citation without an identifier')).toBeUndefined();
  });

  test('returns unmatched items and counts summary entries without disturbing input order', async () => {
    const root = { paper_id: 'W-retracted', doi: '10.1000/retracted', title: 'Retracted source', year: 2001,
      depth: 1, status: [{ source: 'retraction_watch', tier: 'A', is_retracted: true, retraction_date: '2020-01-01', uri: 'https://example.test/status' }],
      weight: 1, agreement: 'strong' };
    const judge = {
      snapshot: async () => ({ id: 'snapshot-1', built_at: '2026-10-25T00:00:00.000Z' }),
      retractionPropagation: async ({ doi }: { doi?: string }) => doi === '10.1234/known'
        ? { snapshot: { id: 'snapshot-1', built_at: '2026-10-25T00:00:00.000Z' }, target: { paper_id: 'W123', doi, title: 'Known paper', year: 1998, source_tier: 'A' as const },
          verdict: 'CONTESTED' as const, confidence: 0.96, confidence_basis: 'retraction_evidence' as const,
          retracted_roots: [root], conflict_flags: [], coverage: { references: 10, resolved: 9, ratio: 0.9, indexed: true }, abstention_reason: null }
        : { snapshot: { id: 'snapshot-1', built_at: '2026-10-25T00:00:00.000Z' }, target: { paper_id: '', doi: doi ?? null, title: null, year: null, source_tier: null },
          verdict: 'INSUFFICIENT_EVIDENCE' as const, confidence: 0.25, confidence_basis: 'coverage' as const,
          retracted_roots: [], conflict_flags: [], coverage: { references: 0, resolved: 0, ratio: 0, indexed: false }, abstention_reason: 'paper_not_in_snapshot' as const },
    } as unknown as Judge;

    const result = await runReferenceBatch(judge, ['10.1234/known', 'No DOI available', '10.9999/missing'], 10);
    expect(result.snapshot.id).toBe('snapshot-1');
    expect(result.items.map((item) => item.input)).toEqual(['10.1234/known', 'No DOI available', '10.9999/missing']);
    expect(result.items[0]).toMatchObject({ matched: true, verdict: 'CONTESTED', confidence: 0.96, retracted_roots: [root] });
    expect(result.items[1]).toMatchObject({ doi: null, matched: false, abstention_reason: 'paper_not_in_snapshot' });
    expect(result.items[2]).toMatchObject({ doi: '10.9999/missing', matched: false, abstention_reason: 'paper_not_in_snapshot' });
    expect(result.summary).toEqual({ requested: 3, matched: 1, unmatched: ['No DOI available', '10.9999/missing'], retracted_root_count: 1 });
  });
});
