import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface CommitInfo {
  hash: string;
  type: string;
  scope?: string;
  summary: string;
  isBreaking: boolean;
  raw: string;
}

const parseCommit = (line: string): CommitInfo | null => {
  const parts = line.split(' ');
  const hash = parts[0];
  const message = parts.slice(1).join(' ').trim();
  if (!hash || !message) return null;

  // Skip release commits
  if (/^chore\(release\):/i.test(message) || /^\[skip ci\]/i.test(message)) {
    return null;
  }

  // Parse conventional commit: type(scope)!: summary or type: summary
  const match = message.match(/^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/);
  if (match) {
    const [, type, scope, breaking, summary] = match;
    return {
      hash,
      type: type.toLowerCase(),
      scope,
      summary,
      isBreaking: Boolean(breaking),
      raw: message,
    };
  }

  return {
    hash,
    type: 'other',
    summary: message,
    isBreaking: false,
    raw: message,
  };
};

const getLatestTag = (): string | null => {
  try {
    const tag = execSync('git describe --tags --abbrev=0', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    return tag || null;
  } catch {
    return null;
  }
};

const getCommitsSinceTag = (tag: string | null): CommitInfo[] => {
  const range = tag ? `${tag}..HEAD` : 'HEAD';
  const output = execSync(`git log ${range} --oneline`, {
    encoding: 'utf8',
  }).trim();

  if (!output) return [];

  return output
    .split('\n')
    .map(parseCommit)
    .filter((c): c is CommitInfo => c !== null);
};

const bumpVersion = (
  current: string,
  bumpType: 'major' | 'minor' | 'patch',
): string => {
  const [major, minor, patch] = current.split('.').map(Number);
  if (bumpType === 'major') return `${major + 1}.0.0`;
  if (bumpType === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
};

const determineBumpType = (
  commits: CommitInfo[],
  overrideType?: string,
): 'major' | 'minor' | 'patch' => {
  if (
    overrideType === 'major' ||
    overrideType === 'minor' ||
    overrideType === 'patch'
  ) {
    return overrideType;
  }

  if (commits.some((c) => c.isBreaking)) return 'major';
  if (commits.some((c) => c.type === 'feat')) return 'minor';
  return 'patch';
};

const formatChangelogSection = (
  version: string,
  date: string,
  commits: CommitInfo[],
): string => {
  const lines: string[] = [];
  lines.push(`## ${version} — ${date}`);
  lines.push('');

  const typeOrder = [
    'feat',
    'fix',
    'perf',
    'refactor',
    'docs',
    'chore',
    'test',
    'ci',
    'other',
  ];
  const grouped = new Map<string, CommitInfo[]>();

  for (const c of commits) {
    const list = grouped.get(c.type) || [];
    list.push(c);
    grouped.set(c.type, list);
  }

  for (const type of typeOrder) {
    const list = grouped.get(type);
    if (!list || list.length === 0) continue;

    for (const item of list) {
      if (item.scope) {
        lines.push(`- **${item.type}(${item.scope})**: ${item.summary}`);
      } else if (item.type !== 'other') {
        lines.push(`- **${item.type}**: ${item.summary}`);
      } else {
        lines.push(`- ${item.summary}`);
      }
    }
  }

  return lines.join('\n');
};

export const runBump = (options: {
  dryRun?: boolean;
  bump?: string;
  projectRoot?: string;
} = {}) => {
  const root = options.projectRoot || resolve(import.meta.dirname, '..');
  const pkgPath = resolve(root, 'package.json');
  const changelogPath = resolve(root, 'CHANGELOG.md');

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const currentVersion: string = pkg.version;

  const latestTag = getLatestTag();
  console.log(`Latest git tag: ${latestTag || '(none)'}`);
  console.log(`Current package.json version: ${currentVersion}`);

  const commits = getCommitsSinceTag(latestTag);
  console.log(`Found ${commits.length} relevant commits since ${latestTag || 'repo start'}.`);

  if (commits.length === 0) {
    console.log('No new commits found to release. Exiting.');
    return { updated: false, version: currentVersion };
  }

  const bumpType = determineBumpType(commits, options.bump);
  const nextVersion = bumpVersion(currentVersion, bumpType);
  const today = new Date().toISOString().split('T')[0];

  console.log(`Calculated bump: ${bumpType} -> Next version: ${nextVersion}`);

  const newSection = formatChangelogSection(nextVersion, today, commits);
  const currentChangelog = readFileSync(changelogPath, 'utf8');

  // Insert under "# Changelog\n\n"
  const changelogHeader = '# Changelog\n\n';
  let updatedChangelog = '';
  if (currentChangelog.startsWith(changelogHeader)) {
    updatedChangelog = `${changelogHeader}${newSection}\n\n${currentChangelog.slice(changelogHeader.length).trimStart()}`;
  } else if (currentChangelog.startsWith('# Changelog')) {
    updatedChangelog = `# Changelog\n\n${newSection}\n\n${currentChangelog.slice('# Changelog'.length).trimStart()}`;
  } else {
    updatedChangelog = `${changelogHeader}${newSection}\n\n${currentChangelog}`;
  }

  pkg.version = nextVersion;

  if (options.dryRun) {
    console.log('--- Dry run preview ---');
    console.log(`[package.json] version: ${nextVersion}`);
    console.log('[CHANGELOG.md]:\n' + newSection);
    return { updated: true, version: nextVersion, dryRun: true };
  }

  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  writeFileSync(changelogPath, updatedChangelog, 'utf8');
  console.log(`Updated package.json to ${nextVersion} and updated CHANGELOG.md.`);

  return { updated: true, version: nextVersion, bumpType, today };
};

// If run directly from CLI
if (import.meta.main || process.argv[1]?.endsWith('bump-version.ts')) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const bumpIndex = args.indexOf('--bump');
  const bump = bumpIndex !== -1 ? args[bumpIndex + 1] : undefined;

  runBump({ dryRun, bump });
}
