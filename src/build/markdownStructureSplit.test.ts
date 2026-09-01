import { describe, expect, it } from 'bun:test';

import {
  mergeSmallSections,
  resolveTopLevelHeading,
  splitByTopLevelHeadings,
} from './markdownStructureSplit';

describe('resolveTopLevelHeading', () => {
  it('uses h1 when there are at least two h1 headings', () => {
    expect(resolveTopLevelHeading('# A\n\nBody A\n\n# B\n\nBody B')).toBe(1);
  });

  it('falls back to h2 when h1 is sparse', () => {
    expect(resolveTopLevelHeading('# Overview\n\n## A\n\nAlpha\n\n## B\n\nBeta')).toBe(2);
  });

  it('returns 1 when no headings are present', () => {
    expect(resolveTopLevelHeading('plain text only')).toBe(1);
  });
});

describe('splitByTopLevelHeadings', () => {
  it('splits by top-level headings and groups preamble into a separate section', () => {
    const sections = splitByTopLevelHeadings(
      'Intro paragraph\n\n# Chapter One\n\nContent A\n\n# Chapter Two\n\nContent B',
    );

    expect(sections).toHaveLength(3);
    expect(sections[0]?.title).toBe('');
    expect(sections[0]?.content).toContain('Intro paragraph');
    expect(sections[1]?.title).toBe('Chapter One');
    expect(sections[1]?.content).toContain('Content A');
    expect(sections[2]?.title).toBe('Chapter Two');
    expect(sections[2]?.content).toContain('Content B');
  });

  it('keeps sub-headings inside their parent section', () => {
    const sections = splitByTopLevelHeadings('# Setting\n\n## Characters\n\nLin Mo');

    expect(sections).toHaveLength(1);
    expect(sections[0]?.title).toBe('Setting');
    expect(sections[0]?.content).toContain('Characters');
    expect(sections[0]?.content).toContain('Lin Mo');
  });

  it('splits by h2 when h1 is sparse, keeping the lone h1 in the preamble', () => {
    const sections = splitByTopLevelHeadings('# Overview\n\n## A\n\nAlpha\n\n## B\n\nBeta');

    expect(sections).toHaveLength(3);
    expect(sections[0]?.title).toBe('');
    expect(sections[0]?.content).toContain('Overview');
    expect(sections[1]?.title).toBe('A');
    expect(sections[1]?.content).toContain('Alpha');
    expect(sections[2]?.title).toBe('B');
    expect(sections[2]?.content).toContain('Beta');
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
