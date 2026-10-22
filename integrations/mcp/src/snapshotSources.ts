import type { BuildSource, SourceRecord } from './store.ts';

type SnapshotSource = BuildSource & { readonly id?: string };

export const encodeSourceTitle = (sourceLabel: string): string =>
  sourceLabel.replaceAll('%', '%25').replaceAll('#', '%23');

export const resolveSnapshotSources = (
  previous: readonly SourceRecord[],
  inputs: readonly BuildSource[],
): { readonly sources: readonly SnapshotSource[]; readonly changed: readonly BuildSource[] } => {
  const sources = new Map<string, SnapshotSource>();
  const changedLabels = new Set<string>();
  for (const source of previous) {
    if (sources.has(source.sourceLabel)) changedLabels.add(source.sourceLabel);
    sources.set(source.sourceLabel, source);
  }
  const latestInputs = new Map(inputs.map((source) => [source.sourceLabel, source]));
  for (const [label, input] of latestInputs) {
    if (sources.get(label)?.contentHash === input.contentHash) continue;
    sources.set(label, input);
    changedLabels.add(label);
  }
  return {
    sources: [...sources.values()],
    changed: [...sources.values()].filter(({ sourceLabel }) => changedLabels.has(sourceLabel)),
  };
};