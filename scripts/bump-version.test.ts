import { describe, expect, test } from 'bun:test';
import { runBump, fetchNpmLatestVersion } from './bump-version';

describe('bump-version script', () => {
  test('fetchNpmLatestVersion retrieves latest tag from registry or returns string', async () => {
    const version = await fetchNpmLatestVersion('@ashes_born/graph-rag-ts');
    if (version !== null) {
      expect(typeof version).toBe('string');
      expect(version.split('.').length).toBe(3);
    }
  });

  test('dry-run execution succeeds and bumps patch for 0.x series', async () => {
    const result = await runBump({
      dryRun: true,
      npmVersionOverride: '0.1.5',
    });
    expect(result.updated).toBeTrue();
    expect(result.version).toBe('0.1.6');
  });

  test('respects explicit bump type in dry run with npm base', async () => {
    const result = await runBump({
      dryRun: true,
      bump: 'minor',
      npmVersionOverride: '0.1.5',
    });
    expect(result.updated).toBeTrue();
    expect(result.version).toBe('0.2.0');
  });
});
