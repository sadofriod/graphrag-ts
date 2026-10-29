import { describe, expect, test } from 'bun:test';
import { classifyContext, normalizeDoi, normalizeOpenAlexId } from './classify.ts';

describe('classifyContext', () => {
  test('applies ordered deterministic keyword groups', () => {
    expect(classifyContext('The retraction was questioned as flawed')).toBe('acknowledges_retraction');
    expect(classifyContext('The result is invalid and not replicated')).toBe('critical');
    expect(classifyContext('Our findings replicate prior work')).toBe('supporting_evidence');
    expect(classifyContext('A methodological comparison follows')).toBe('neutral');
    expect(classifyContext('  ')).toBe('unknown');
  });
});

describe('identifier normalization', () => {
  test('normalizes DOI URL and prefixes without changing DOI punctuation', () => {
    expect(normalizeDoi(' HTTPS://doi.org/10.1000/ABC.12 ')).toBe('10.1000/abc.12');
    expect(normalizeDoi('doi: 10.1000/ABC')).toBe('10.1000/abc');
    expect(normalizeDoi(null)).toBeNull();
  });

  test('normalizes OpenAlex work URLs and short ids', () => {
    expect(normalizeOpenAlexId('https://openalex.org/w2117847125')).toBe('W2117847125');
    expect(normalizeOpenAlexId('w123')).toBe('W123');
    expect(normalizeOpenAlexId(undefined)).toBeNull();
  });
});
