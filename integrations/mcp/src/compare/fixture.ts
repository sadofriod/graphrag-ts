import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const questions = [
  { id: 'decision-impact', query: 'Why replace Redis sessions with PostgreSQL, and which modules changed?',
    sources: ['adr-session-storage.md', 'changelog-session-rollout.md'] },
  { id: 'cleanup-owners', query: 'Which team owns cleanup, and which rollout checks must it review?',
    sources: ['changelog-session-rollout.md', 'runbook-session-rollout.md'] },
  { id: 'remaining-redis', query: 'Which Redis workload remained, and why was it outside ADR-007?',
    sources: ['adr-session-storage.md', 'architecture-overview.md'] },
  { id: 'suspension-path', query: 'How does account suspension reach the session store, and who owns those modules?',
    sources: ['architecture-overview.md', 'changelog-session-rollout.md'] },
  { id: 'rejected-queue', query: "Why is a Redis deletion retry queue insufficient for the decision's goal?",
    sources: ['adr-session-storage.md', 'architecture-overview.md'] },
] as const;

export const loadCorpus = async (): Promise<readonly { sourceLabel: string; content: string }[]> =>
  Promise.all([
    'adr-session-storage.md', 'architecture-overview.md',
    'changelog-session-rollout.md', 'runbook-session-rollout.md',
  ].map(async (sourceLabel) => ({
    sourceLabel,
    content: await readFile(new URL(`../../../../examples/project-history/corpus/${sourceLabel}`, import.meta.url), 'utf8'),
  })));

export const corpusHash = (sources: readonly { sourceLabel: string; content: string }[]): string =>
  createHash('sha256').update(JSON.stringify([...sources]
    .sort((a, b) => a.sourceLabel.localeCompare(b.sourceLabel))
    .map(({ sourceLabel, content }) => [sourceLabel, content.trim()]))).digest('hex');

export type SourceExcerpt = { readonly source: string; readonly excerpt: string };

export const evaluateSources = (expected: readonly string[], sources: readonly SourceExcerpt[]) => {
  if (expected.length === 0 || new Set(expected).size !== expected.length) {
    throw new Error('Expected sources must be nonempty and unique.');
  }
  const actual = new Set(sources.filter((source) => source.excerpt.trim()).map((source) => source.source));
  const matched = expected.filter((source) => actual.has(source));
  return {
    expected_sources: expected,
    matched_sources: matched,
    source_coverage: matched.length / expected.length,
    covers_cross_document_sources: expected.length > 1 && matched.length === expected.length,
    source_excerpts: sources,
  };
};
