import { describe, expect, test } from 'bun:test';
import { corpusHash, evaluateSources, loadCorpus, questions } from './fixture.ts';

describe('decision-history evidence probe', () => {
  test('has four original documents and five questions with resolvable cross-document expectations', async () => {
    const corpus = await loadCorpus();
    expect(corpus).toHaveLength(4);
    expect(questions).toHaveLength(5);
    for (const question of questions) {
      expect(new Set(question.sources).size).toBe(2);
      for (const source of question.sources) expect(corpus.some((file) => file.sourceLabel === source)).toBe(true);
    }
    for (const source of corpus) expect(source.content).toMatch(/fictional/);
    expect(corpusHash(corpus)).toBe(corpusHash([...corpus].reverse()));
    expect(corpusHash(corpus)).not.toBe(corpusHash(corpus.slice(1)));
  });

  test('scores source evidence, not answer phrases or duplicate/empty citations', () => {
    const expected = ['adr.md', 'changes.md'];
    const partial = evaluateSources(expected, [
      { source: 'adr.md', excerpt: 'decision' },
      { source: 'adr.md', excerpt: 'duplicate' },
      { source: 'changes.md', excerpt: ' ' },
      { source: 'other.md', excerpt: 'mentions changes.md' },
    ]);
    expect(partial.source_coverage).toBe(0.5);
    expect(partial.covers_cross_document_sources).toBe(false);
    expect(evaluateSources(expected, expected.map((source) => ({ source, excerpt: 'evidence' }))))
      .toMatchObject({ source_coverage: 1, covers_cross_document_sources: true });
    expect(evaluateSources(expected, []).source_coverage).toBe(0);
    expect(() => evaluateSources([], [])).toThrow();
    expect(() => evaluateSources(['a', 'a'], [])).toThrow();
  });
});
