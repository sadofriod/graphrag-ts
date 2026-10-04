import { describe, expect, it } from 'bun:test';

import { estimateTokens } from '../../build/detectCommunity/summary/estimateTokens';
import { buildSummaryBatches } from './summaryBatcher';

describe('buildSummaryBatches', () => {
  it('splits oversized community summaries and keeps their source IDs', () => {
    const promptSkeleton = 'Question: explain the global trend.';
    const summaries = [{ id: 'community-1', text: 'Shared trend. '.repeat(120) }];

    const batches = buildSummaryBatches(summaries, promptSkeleton, 80, () => 0);

    expect(batches.length).toBeGreaterThan(1);
    expect(batches.every((batch) => batch.communityIds.length > 0)).toBe(true);
    expect(batches.every((batch) => batch.communityIds.includes('community-1'))).toBe(true);
    expect(
      batches.every((batch) => estimateTokens(`${promptSkeleton}\n${batch.content}`) <= 80),
    ).toBe(true);
  });

  it('rejects a budget that cannot fit the prompt and one summary part', () => {
    expect(() => buildSummaryBatches([{ id: 'c1', text: 'summary' }], 'a long prompt', 1))
      .toThrow('Map token budget cannot fit the Map prompt.');
    expect(() => buildSummaryBatches([{ id: 'c1', text: 'summary' }], '', 2))
      .toThrow('Map token budget is too small for community summary c1.');
  });
});
