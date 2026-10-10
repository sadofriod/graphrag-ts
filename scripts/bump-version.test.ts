import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  fetchNpmLatestVersion,
  getCommitsSinceTag,
  runBump,
} from './bump-version';

const temporaryProjects: string[] = [];

const createProject = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'bump-version-test-'));
  temporaryProjects.push(root);

  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'test-package', version: '0.1.5' }),
  );
  writeFileSync(join(root, 'CHANGELOG.md'), '# Changelog\n\n');
  execFileSync('git', ['init', root]);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Test']);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', [
    '-C',
    root,
    'commit',
    '-m',
    'chore(release): 0.1.5 [skip ci]',
  ]);
  writeFileSync(join(root, 'feature.txt'), 'new feature\n');
  execFileSync('git', ['-C', root, 'add', 'feature.txt']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'feat: add new feature']);

  return root;
};

afterEach(() => {
  for (const root of temporaryProjects) {
    rmSync(root, { recursive: true, force: true });
  }
  temporaryProjects.length = 0;
});

describe('bump-version script', () => {
  test('fetchNpmLatestVersion retrieves latest tag from registry or returns string', async () => {
    const version = await fetchNpmLatestVersion('@ashes_born/graph-rag-ts');
    if (version !== null) {
      expect(typeof version).toBe('string');
      expect(version.split('.').length).toBe(3);
    }
  });

  test('dry-run execution succeeds and bumps patch for 0.x series', async () => {
    const projectRoot = createProject();
    const result = await runBump({
      dryRun: true,
      npmVersionOverride: '0.1.5',
      projectRoot,
    });
    expect(result.updated).toBeTrue();
    expect(result.version).toBe('0.1.6');
  });

  test('respects explicit bump type in dry run with npm base', async () => {
    const projectRoot = createProject();
    const result = await runBump({
      dryRun: true,
      bump: 'minor',
      npmVersionOverride: '0.1.5',
      projectRoot,
    });
    expect(result.updated).toBeTrue();
    expect(result.version).toBe('0.2.0');
  });

  test('uses the latest release commit when release tags are missing', () => {
    const projectRoot = createProject();
    const commits = getCommitsSinceTag(null, projectRoot);

    expect(commits.map(({ summary }) => summary)).toEqual(['add new feature']);
    expect(readFileSync(join(projectRoot, 'CHANGELOG.md'), 'utf8')).toBe(
      '# Changelog\n\n',
    );
  });
});
