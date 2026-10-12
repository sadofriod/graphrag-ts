import { describe, expect, it } from 'bun:test';
import { DETERMINISTIC_THRESHOLD, MARKDOWN_STRUCTURE_THRESHOLD } from '../../src/build/constants';

import {
  CORPUS_SCOPE_QUERIES,
  GLOBAL_MAP_REDUCE_QUERIES,
  INCREMENTAL_UPDATE_QUERY,
  IN_CORPUS_RECALL_QUERIES,
  QUICKSTART_RECALL_QUERIES,
  RECALL_QUERIES,
} from './dataset';

describe('RECALL_QUERIES', () => {
  it('keeps the benchmark grounded in the sources indexed in the current GraphRAG namespace', () => {
    const sources = new Set(RECALL_QUERIES.map((query) => query.source));

    expect(sources).not.toContain('The Adventures of Sherlock Holmes');
    expect(Array.from(sources).sort()).toEqual([
      "Alice's Adventures in Wonderland",
      'Frankenstein',
    ]);
  });

  it('uses only questions whose source chapters are indexed for recall scoring', () => {
    expect(RECALL_QUERIES).toHaveLength(12);
    expect(RECALL_QUERIES.every((query) => query.sourceCoverage === 'indexed')).toBe(true);
    expect(IN_CORPUS_RECALL_QUERIES).toBe(RECALL_QUERIES);
  });
});

describe('CORPUS_SCOPE_QUERIES', () => {
  it('preserves the original 12 questions and separates five indexed controls from seven absent chapters', () => {
    expect(CORPUS_SCOPE_QUERIES.map((query) => query.id)).toEqual([
      'alice-rabbit-hole',
      'alice-mad-tea-party',
      'alice-dormouse-tale',
      'alice-caterpillar-advice',
      'frankenstein-creation',
      'frankenstein-de-lacey',
      'frankenstein-justine',
      'frankenstein-mont-blanc',
      'alice-queen-of-hearts',
      'alice-caterpillar-identity',
      'frankenstein-female-companion',
      'frankenstein-arctic-confession',
    ]);
    expect(CORPUS_SCOPE_QUERIES.filter((query) => query.sourceCoverage === 'indexed')).toHaveLength(5);
    expect(CORPUS_SCOPE_QUERIES.filter((query) => query.sourceCoverage === 'not-indexed')).toHaveLength(7);
  });
});

describe('IN_CORPUS_RECALL_QUERIES', () => {
  it('covers only sources currently mounted in the benchmark corpus', () => {
    expect(IN_CORPUS_RECALL_QUERIES).toHaveLength(12);
    expect(IN_CORPUS_RECALL_QUERIES.every((query) => query.sourceCoverage === 'indexed')).toBe(true);
    const sources = new Set(IN_CORPUS_RECALL_QUERIES.map((query) => query.source));
    expect(Array.from(sources).sort()).toEqual([
      "Alice's Adventures in Wonderland",
      'Frankenstein',
    ]);
  });
});

describe('QUICKSTART_RECALL_QUERIES', () => {
  it('keeps the Docker quick profile small and tied to its bundled corpus', () => {
    expect(QUICKSTART_RECALL_QUERIES).toHaveLength(3);
    expect(QUICKSTART_RECALL_QUERIES.every((query) => query.source === 'Northstar Community Lab'))
      .toBe(true);
    expect(QUICKSTART_RECALL_QUERIES.every((query) => query.sourceCoverage === 'indexed'))
      .toBe(true);
  });

  it('exercises LLM graph extraction without entering hierarchical markdown splitting', async () => {
    const corpus = await Bun.file(
      new URL('../quickstart-corpus/northstar-community-lab.md', import.meta.url),
    ).text();

    expect(corpus.length).toBeGreaterThan(DETERMINISTIC_THRESHOLD);
    expect(corpus.length).toBeLessThan(MARKDOWN_STRUCTURE_THRESHOLD);
  });
});

describe('workflow benchmark queries', () => {
  it('includes dedicated Global Map Reduce cases and an incremental-only fact check', () => {
    expect(GLOBAL_MAP_REDUCE_QUERIES).toHaveLength(2);
    expect(GLOBAL_MAP_REDUCE_QUERIES.map(({ id }) => id)).toEqual([
      'global-alice-creature-learning',
      'global-victor-creation-cost',
    ]);
    expect(INCREMENTAL_UPDATE_QUERY.id).toBe('incremental-alice-archive-note');
    expect(INCREMENTAL_UPDATE_QUERY.expectation.phrases).toContain('west observatory');
    expect(GLOBAL_MAP_REDUCE_QUERIES[1]?.expectation.phrases).toContain('nervous fever');
    expect(GLOBAL_MAP_REDUCE_QUERIES[1]?.expectation.phrases).not.toContain('wretchedness and despair');
  });
});
