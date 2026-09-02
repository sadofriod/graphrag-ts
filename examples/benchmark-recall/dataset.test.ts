import { describe, expect, it } from 'bun:test';

import { RECALL_QUERIES } from './dataset';

describe('RECALL_QUERIES', () => {
  it('keeps the benchmark grounded in the sources indexed in the current GraphRAG namespace', () => {
    const sources = new Set(RECALL_QUERIES.map((query) => query.source));

    expect(sources).not.toContain('The Adventures of Sherlock Holmes');
    expect(Array.from(sources).sort()).toEqual([
      "Alice's Adventures in Wonderland",
      'Frankenstein',
    ]);
  });
});
