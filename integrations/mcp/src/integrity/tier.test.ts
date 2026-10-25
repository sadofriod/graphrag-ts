import { describe, expect, test } from 'bun:test';
import { agreementLabel, contextFactor, detectConflicts, evidenceWeight, tierWeight } from './tier.ts';
import type { RetractionRecord } from './types.ts';

const record = (source: RetractionRecord['source'], tier: RetractionRecord['source_tier'], is_retracted: boolean): RetractionRecord => ({
  paper_id: 'W1', doi: null, source, source_tier: tier, is_retracted, source_uri: `https://${source}.example`, source_chunk_id: null, observed_at: '2025-01-01',
});

describe('integrity tier helpers', () => {
  test('uses the contract weights and sorted agreement label', () => {
    expect((['A', 'B', 'C', 'D'] as const).map(tierWeight)).toEqual([1, 0.6, 0.3, 0]);
    expect(agreementLabel(['C', 'A', 'A'])).toBe('A+A+C');
    expect(evidenceWeight([record('crossref', 'A', true), record('openalex', 'C', false)])).toBe(1);
    expect(evidenceWeight([record('crossref', 'A', true), record('retraction_watch', 'A', true)])).toBe(1);
  });

  test('detects source, aggregator, and acknowledgment conflicts', () => {
    const flags = detectConflicts([
      record('crossref', 'A', true), record('retraction_watch', 'A', false),
    ], { openAlexFlag: false, contexts: ['acknowledges_retraction'] });
    expect(flags.map((flag) => flag.code)).toEqual(['SOURCE_STATUS_CONFLICT', 'AGGREGATOR_FALSE_NEGATIVE']);
    expect(detectConflicts([], { contexts: ['acknowledges_retraction'] }).map((flag) => flag.code)).toEqual(['RETRACTION_ACKNOWLEDGED_NOT_PROPAGATED']);
    expect(detectConflicts([record('openalex', 'C', true)]).map((flag) => flag.code)).toEqual(['AGGREGATOR_ONLY_EVIDENCE']);
    expect(contextFactor('critical')).toBe(1);
    expect(contextFactor('neutral')).toBe(0);
  });
});
