import { describe, expect, it } from 'bun:test';

import {
  mergeSmallSections,
  resolveTopLevelHeading,
  splitByTopLevelHeadings,
} from './markdownStructureSplit';

describe('resolveTopLevelHeading', () => {
  it('uses h1 when there are at least two h1 headings', () => {
    expect(resolveTopLevelHeading('# A\n\n正文甲\n\n# B\n\n正文乙')).toBe(1);
  });

  it('falls back to h2 when h1 is sparse', () => {
    expect(resolveTopLevelHeading('# 总览\n\n## A\n\n甲\n\n## B\n\n乙')).toBe(2);
  });

  it('returns 1 when no headings are present', () => {
    expect(resolveTopLevelHeading('plain text only')).toBe(1);
  });
});

describe('splitByTopLevelHeadings', () => {
  it('splits by top-level headings and groups preamble into a separate section', () => {
    const sections = splitByTopLevelHeadings(
      '引言段落\n\n# 第一章\n\n内容甲\n\n# 第二章\n\n内容乙',
    );

    expect(sections).toHaveLength(3);
    expect(sections[0]?.title).toBe('');
    expect(sections[0]?.content).toContain('引言段落');
    expect(sections[1]?.title).toBe('第一章');
    expect(sections[1]?.content).toContain('内容甲');
    expect(sections[2]?.title).toBe('第二章');
    expect(sections[2]?.content).toContain('内容乙');
  });

  it('keeps sub-headings inside their parent section', () => {
    const sections = splitByTopLevelHeadings('# 设定\n\n## 角色\n\n林默');

    expect(sections).toHaveLength(1);
    expect(sections[0]?.title).toBe('设定');
    expect(sections[0]?.content).toContain('角色');
    expect(sections[0]?.content).toContain('林默');
  });

  it('splits by h2 when h1 is sparse, keeping the lone h1 in the preamble', () => {
    const sections = splitByTopLevelHeadings('# 总览\n\n## A\n\n甲\n\n## B\n\n乙');

    expect(sections).toHaveLength(3);
    expect(sections[0]?.title).toBe('');
    expect(sections[0]?.content).toContain('总览');
    expect(sections[1]?.title).toBe('A');
    expect(sections[1]?.content).toContain('甲');
    expect(sections[2]?.title).toBe('B');
    expect(sections[2]?.content).toContain('乙');
  });
});

describe('mergeSmallSections', () => {
  it('merges adjacent small sections and concatenates their titles', () => {
    const merged = mergeSmallSections(
      [
        { title: 'A', content: 'short-a', headingLevel: 1 },
        { title: 'B', content: 'short-b', headingLevel: 1 },
        { title: 'C', content: 'x'.repeat(3000), headingLevel: 1 },
      ],
      2000,
    );

    expect(merged).toHaveLength(2);
    expect(merged[0]?.title).toContain('A');
    expect(merged[0]?.title).toContain('B');
    expect(merged[0]?.content).toContain('short-b');
    expect(merged[1]?.title).toBe('C');
  });

  it('keeps sections already above the minimum size intact', () => {
    const merged = mergeSmallSections(
      [{ title: 'A', content: 'x'.repeat(3000), headingLevel: 1 }],
      2000,
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.title).toBe('A');
  });
});
