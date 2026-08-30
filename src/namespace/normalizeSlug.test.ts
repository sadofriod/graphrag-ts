import { describe, expect, it } from 'bun:test';

import { normalizeSlug } from './normalizeSlug';

describe('normalizeSlug', () => {
  it('passes through a valid slug unchanged', () => {
    expect(normalizeSlug('my-workspace')).toBe('my-workspace');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeSlug('  my-workspace  ')).toBe('my-workspace');
  });

  it('lowercases the input', () => {
    expect(normalizeSlug('My-Workspace')).toBe('my-workspace');
  });

  it('accepts a single character', () => {
    expect(normalizeSlug('a')).toBe('a');
  });

  it('accepts a leading digit', () => {
    expect(normalizeSlug('2fa')).toBe('2fa');
  });

  it('accepts the maximum length of 63 characters', () => {
    const slug = `${'a'.repeat(61)}-b`;
    expect(normalizeSlug(slug)).toBe(slug);
  });

  it('rejects an empty string', () => {
    expect(normalizeSlug('')).toBeUndefined();
  });

  it('rejects whitespace-only input', () => {
    expect(normalizeSlug('   ')).toBeUndefined();
  });

  it('rejects a leading hyphen', () => {
    expect(normalizeSlug('-abc')).toBeUndefined();
  });

  it('rejects an embedded space', () => {
    expect(normalizeSlug('my workspace')).toBeUndefined();
  });

  it('rejects an underscore', () => {
    expect(normalizeSlug('my_workspace')).toBeUndefined();
  });

  it('rejects a slug longer than 63 characters', () => {
    expect(normalizeSlug('a'.repeat(64))).toBeUndefined();
  });

  it('rejects non-ASCII characters', () => {
    expect(normalizeSlug('工作区')).toBeUndefined();
  });
});
