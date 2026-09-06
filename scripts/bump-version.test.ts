import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runBump } from './bump-version';

describe('bump-version script', () => {
  test('dry-run execution succeeds without modifying files', () => {
    const result = runBump({ dryRun: true });
    expect(result.updated).toBeTrue();
    expect(result.version).toBeDefined();
  });

  test('respects explicit bump type in dry run', () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'));
    const [major, minor, patch] = pkg.version.split('.').map(Number);
    const expectedPatchVersion = `${major}.${minor}.${patch + 1}`;

    const result = runBump({ dryRun: true, bump: 'patch' });
    expect(result.updated).toBeTrue();
    expect(result.version).toBe(expectedPatchVersion);
  });
});
