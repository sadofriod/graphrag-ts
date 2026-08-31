import { describe, expect, it } from 'bun:test';

import type { RetrievalResult } from '../retrieval/types/retrieval';
import { buildRetrievedContext } from './context';

const sample = (overrides: Partial<RetrievalResult> = {}): RetrievalResult => ({
  query: 'q',
  communities: [
    {
      id: 'c1',
      name: 'Community A',
      summary: 'Community summary content',
      members: ['Kai', 'Chen'],
      matchedEntities: ['Kai'],
      score: 0.9,
    },
  ],
  evidence: [{ text: 'Source evidence snippet' }],
  answer: 'LLM-generated answer',
  ...overrides,
});

describe('buildRetrievedContext', () => {
  it('includes community name, members and summary', () => {
    const context = buildRetrievedContext(sample());
    expect(context).toContain('Community A');
    expect(context).toContain('Kai');
    expect(context).toContain('Chen');
    expect(context).toContain('Community summary content');
  });

  it('includes evidence text', () => {
    const context = buildRetrievedContext(sample());
    expect(context).toContain('Source evidence snippet');
  });

  it('excludes answer by default', () => {
    const context = buildRetrievedContext(sample());
    expect(context).not.toContain('LLM-generated answer');
  });

  it('includes answer when includeAnswer is true', () => {
    const context = buildRetrievedContext(sample(), { includeAnswer: true });
    expect(context).toContain('LLM-generated answer');
  });

  it('skips empty optional fields', () => {
    const context = buildRetrievedContext(
      sample({
        communities: [{ id: 'c1', members: [], matchedEntities: [], score: 0 }],
        evidence: [],
        answer: '',
      }),
    );
    expect(context).toBe('');
  });
});
