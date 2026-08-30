import { describe, expect, it } from 'bun:test';

import { extensionOf, isTextFile } from './textFile';

describe('textFile', () => {
  it('derives a lowercase extension from the file name', () => {
    expect(extensionOf('doc.MD')).toBe('.md');
    expect(extensionOf('notes.txt')).toBe('.txt');
    expect(extensionOf('noext')).toBe('');
  });

  it('accepts only txt and md files', () => {
    expect(isTextFile('a.txt')).toBe(true);
    expect(isTextFile('a.md')).toBe(true);
    expect(isTextFile('a.docx')).toBe(false);
    expect(isTextFile('a')).toBe(false);
  });
});
