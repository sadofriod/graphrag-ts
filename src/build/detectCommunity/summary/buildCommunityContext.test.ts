import { afterEach, describe, expect, it } from 'bun:test';

import { buildCommunityContext, getCommunityContextMaxTokens } from './buildCommunityContext';

const sampleInput = {
  members: ['A', 'B', 'C', 'D', 'E'],
  entities: [
    { name: 'A', description: 'central entity' },
    { name: 'D', description: 'leaves often' },
  ],
  edges: [
    { source: 'A', target: 'B', relationshipDesc: 'leads' },
    { source: 'B', target: 'C', relationshipDesc: 'follows' },
    { source: 'A', target: 'D', relationshipDesc: 'works_with' },
    { source: 'D', target: 'E', relationshipDesc: 'leaves' },
  ],
  claims: [
    { subject: 'E', description: 'E is minor' },
    { subject: 'A', description: 'A is central' },
    { subject: 'B', object: 'C', description: 'B works with C' },
  ],
};

describe('buildCommunityContext', () => {
  it('builds the four sections with members and node summaries first', () => {
    const output = buildCommunityContext(sampleInput, { maxTokens: 1000 });

    expect(output).toContain('【成员】A、B、C、D、E');
    expect(output).toContain('【节点摘要】');
    expect(output).toContain('- A: central entity');
    expect(output).toContain('- D: leaves often');
  });

  it('sorts edges by endpoint degree sum and claims by referenced-entity degree', () => {
    const output = buildCommunityContext(sampleInput, { maxTokens: 1000 });

    // 度: A=2, B=2, C=1, D=2, E=1 → 边序 A-B(4), A-D(4), B-C(3), D-E(3)
    expect(output).toContain('1. A --leads--> B');
    expect(output).toContain('2. A --works_with--> D');
    expect(output).toContain('3. B --follows--> C');
    expect(output).toContain('4. D --leaves--> E');

    // 声明按 subject/object 最高度降序: A(3), B-C(2), E(1)
    expect(output).toContain('1. A: A is central');
    expect(output).toContain('2. B（关联 C）: B works with C');
    expect(output).toContain('3. E: E is minor');
  });

  it('truncates low-priority items when the token budget is exceeded', () => {
    const output = buildCommunityContext(sampleInput, { maxTokens: 10 });

    expect(output).toContain('【成员】A、B、C、D、E');
    expect(output).not.toContain('--leads-->');
    expect(output).not.toContain('【事实声明】');
  });

  it('handles an empty community with no edges or claims', () => {
    const output = buildCommunityContext(
      { members: [], entities: [], edges: [], claims: [] },
      { maxTokens: 1000 },
    );

    expect(output).toBe('【成员】');
  });

  it('omits absent sections', () => {
    const onlyEdges = buildCommunityContext(
      { members: ['A', 'B'], entities: [], edges: [{ source: 'A', target: 'B', relationshipDesc: 'x' }], claims: [] },
      { maxTokens: 1000 },
    );
    expect(onlyEdges).toContain('【关键关系】');
    expect(onlyEdges).not.toContain('【事实声明】');
    expect(onlyEdges).not.toContain('【节点摘要】');

    const onlyClaims = buildCommunityContext(
      { members: ['A'], entities: [], edges: [], claims: [{ subject: 'A', description: 'fact' }] },
      { maxTokens: 1000 },
    );
    expect(onlyClaims).toContain('【事实声明】');
    expect(onlyClaims).not.toContain('【关键关系】');
  });
});

describe('getCommunityContextMaxTokens', () => {
  const original = process.env.RAG_COMMUNITY_CONTEXT_MAX_TOKENS;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.RAG_COMMUNITY_CONTEXT_MAX_TOKENS;
    } else {
      process.env.RAG_COMMUNITY_CONTEXT_MAX_TOKENS = original;
    }
  });

  it('defaults to 4000 when not configured', () => {
    delete process.env.RAG_COMMUNITY_CONTEXT_MAX_TOKENS;
    expect(getCommunityContextMaxTokens()).toBe(4000);
  });

  it('reads a positive override from the environment', () => {
    process.env.RAG_COMMUNITY_CONTEXT_MAX_TOKENS = '3000';
    expect(getCommunityContextMaxTokens()).toBe(3000);
  });

  it('falls back to the default for invalid values', () => {
    process.env.RAG_COMMUNITY_CONTEXT_MAX_TOKENS = 'abc';
    expect(getCommunityContextMaxTokens()).toBe(4000);
  });
});
