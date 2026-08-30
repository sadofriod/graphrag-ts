import { describe, expect, it } from 'bun:test';

import type { RetrievalResult } from '../retrieval/types/retrieval';
import { buildRetrievedContext } from './context';

const sample = (overrides: Partial<RetrievalResult> = {}): RetrievalResult => ({
  query: 'q',
  communities: [
    {
      id: 'c1',
      name: '社区A',
      summary: '社区摘要内容',
      members: ['凯', '老陈'],
      matchedEntities: ['凯'],
      score: 0.9,
    },
  ],
  evidence: [{ text: '证据原文片段' }],
  answer: 'LLM 生成的回答',
  ...overrides,
});

describe('buildRetrievedContext', () => {
  it('includes community name, members and summary', () => {
    const context = buildRetrievedContext(sample());
    expect(context).toContain('社区A');
    expect(context).toContain('凯');
    expect(context).toContain('老陈');
    expect(context).toContain('社区摘要内容');
  });

  it('includes evidence text', () => {
    const context = buildRetrievedContext(sample());
    expect(context).toContain('证据原文片段');
  });

  it('excludes answer by default', () => {
    const context = buildRetrievedContext(sample());
    expect(context).not.toContain('LLM 生成的回答');
  });

  it('includes answer when includeAnswer is true', () => {
    const context = buildRetrievedContext(sample(), { includeAnswer: true });
    expect(context).toContain('LLM 生成的回答');
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
