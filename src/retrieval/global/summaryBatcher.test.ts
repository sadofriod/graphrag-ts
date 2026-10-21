import { describe, expect, it } from 'bun:test';

import { estimateTokens } from '../../build/detectCommunity/summary/estimateTokens';
import { buildSummaryBatches, createSeededRandom } from './summaryBatcher';

describe('buildSummaryBatches', () => {
  it('preserves logical ordering across new physical IDs and unrelated additions', () => {
    const summaries = ['first', 'second', 'third'].map((name) => ({
      id: name, stableId: `logical-${name}`, text: `Summary ${name}.`,
    }));
    const original = buildSummaryBatches(summaries, 'Question', 1000);
    const cloned = summaries.toReversed().map((summary) => ({ ...summary, id: `copy-${summary.id}` }));
    const copy = buildSummaryBatches(cloned, 'Question', 1000);
    expect(copy.map(({ content }) => content)).toEqual(original.map(({ content }) => content));
    expect(copy.flatMap(({ communityIds }) => communityIds)).toEqual(
      original.flatMap(({ communityIds }) => communityIds.map((id) => `copy-${id}`)),
    );
    const extended = buildSummaryBatches([
      { id: 'new', stableId: 'logical-new', text: 'New unrelated summary.' }, ...summaries.toReversed(),
    ], 'Question', 1000);
    expect(extended.flatMap(({ communityIds }) => communityIds).filter((id) => id !== 'new')).toEqual(
      original.flatMap(({ communityIds }) => communityIds),
    );
  });

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

  it('keeps batch ordering stable for the same seed', () => {
    const summaries = [
      { id: 'c1', text: 'First summary.' },
      { id: 'c2', text: 'Second summary.' },
      { id: 'c3', text: 'Third summary.' },
    ];

    const firstRun = buildSummaryBatches(summaries, 'Question: explain.', 80, createSeededRandom('query-snapshot'));
    const secondRun = buildSummaryBatches(summaries, 'Question: explain.', 80, createSeededRandom('query-snapshot'));

    expect(secondRun).toEqual(firstRun);
  });
});
