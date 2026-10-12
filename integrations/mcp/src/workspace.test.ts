import { describe, expect, test } from 'bun:test';
import { DEFAULT_WORKSPACE_ID, workspaceIdSchema } from './workspace.ts';

describe('workspaceIdSchema', () => {
  test('defaults omitted workspace IDs to the legacy default workspace', () => {
    expect(workspaceIdSchema.parse(undefined)).toBe(DEFAULT_WORKSPACE_ID);
  });

  test('normalizes surrounding whitespace and accepts lowercase slugs', () => {
    expect(workspaceIdSchema.parse('  team-alpha  ')).toBe('team-alpha');
  });

  test('rejects unsafe or non-canonical workspace IDs', () => {
    for (const value of ['', 'Team Alpha', '../tenant', '-team', 'a'.repeat(64)]) {
      expect(() => workspaceIdSchema.parse(value)).toThrow();
    }
  });
});
