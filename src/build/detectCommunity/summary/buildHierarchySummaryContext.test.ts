import { describe, expect, it } from 'bun:test';

import { buildHierarchySummaryContext } from './buildHierarchySummaryContext';

describe('buildHierarchySummaryContext', () => {
  it('uses detailed element summaries when they fit the context budget', () => {
    const result = buildHierarchySummaryContext('element details', 'bounded details', [], 20);

    expect(result).toBe('element details');
  });

  it('substitutes lower-level reports when detailed context exceeds the budget', () => {
    const result = buildHierarchySummaryContext(
      'element details '.repeat(30),
      'bounded details',
      [{ communityName: 'Policy', summaryContent: 'A concise policy report.' }],
      20,
    );

    expect(result).toContain('[Sub-community reports]');
    expect(result).toContain('A concise policy report.');
    expect(result).not.toContain('element details');
  });
});