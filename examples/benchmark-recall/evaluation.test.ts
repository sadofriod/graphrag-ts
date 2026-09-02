import { describe, expect, it } from 'bun:test';

import { buildRetrievedContext, evaluateRecall } from './evaluation';
import type { RetrievalResult } from '../../src/retrieval/types/retrieval';

const result = (overrides: Partial<RetrievalResult> = {}): RetrievalResult => ({
  query: 'q',
  communities: [
    {
      id: 'c1',
      members: ['Alice', 'White Rabbit'],
      matchedEntities: ['Alice'],
      score: 0.9,
      name: 'Wonderland opening',
      summary: 'Alice follows the White Rabbit.',
    },
  ],
  evidence: [{ text: 'The Rabbit took a watch out of its waistcoat-pocket.' }],
  answer: 'The answer mentions ORANGE MARMALADE.',
  ...overrides,
});

describe('buildRetrievedContext', () => {
  it('uses communities and evidence by default', () => {
    const context = buildRetrievedContext(result());

    expect(context).toContain('Alice');
    expect(context).toContain('White Rabbit');
    expect(context).toContain('waistcoat-pocket');
    expect(context).not.toContain('ORANGE MARMALADE');
  });

  it('can include the generated answer for end-to-end recall', () => {
    const context = buildRetrievedContext(result(), { includeAnswer: true });

    expect(context).toContain('ORANGE MARMALADE');
  });
});

describe('evaluateRecall', () => {
  it('evaluates entity and phrase recall case-insensitively', () => {
    const evaluation = evaluateRecall('alice met the white rabbit near a waistcoat-pocket', {
      entities: ['Alice', 'White Rabbit'],
      phrases: ['WAISTCOAT-POCKET', 'large rabbit-hole'],
    });

    expect(evaluation.entityRecall).toBe(1);
    expect(evaluation.phraseRecall).toBe(0.5);
    expect(evaluation.combinedRecall).toBe(0.75);
    expect(evaluation.hit).toBe(false);
    expect(evaluation.missingPhrases).toEqual(['large rabbit-hole']);
  });

  it('normalizes punctuation and whitespace when checking phrases', () => {
    const evaluation = evaluateRecall("Alice noticed the White Rabbit with a waistcoat pocket and it's always tea-time.", {
      entities: ['Alice', 'White Rabbit'],
      phrases: ['waistcoat pocket', "it's always tea time"],
    });

    expect(evaluation.entityRecall).toBe(1);
    expect(evaluation.phraseRecall).toBe(1);
    expect(evaluation.hit).toBe(true);
    expect(evaluation.missingPhrases).toEqual([]);
  });

  it('allows common wording drift in phrase matching', () => {
    const evaluation = evaluateRecall('The mighty and icy Alps loomed over them, and it is always tea time in Wonderland.', {
      entities: ['Alps'],
      phrases: ['mighty Alps', "it's always tea time"],
    });

    expect(evaluation.entityRecall).toBe(1);
    expect(evaluation.phraseRecall).toBe(1);
    expect(evaluation.hit).toBe(true);
    expect(evaluation.missingPhrases).toEqual([]);
  });

  it('treats semantically equivalent wording as a valid phrase match', () => {
    const evaluation = evaluateRecall(
      'He was wretched and desperate, and the burden of knowledge left him in misery.',
      {
        entities: ['He'],
        phrases: ['wretchedness and despair', 'burden of knowledge'],
      },
    );

    expect(evaluation.entityRecall).toBe(1);
    expect(evaluation.phraseRecall).toBe(1);
    expect(evaluation.hit).toBe(true);
    expect(evaluation.missingPhrases).toEqual([]);
  });
});