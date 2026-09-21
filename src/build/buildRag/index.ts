import { withNamespace } from '../../namespace/namespaceContext';
import { resolveBuildResolution } from './incremental';
import { persistSplitResults } from './persist';
import type { BuildInputFile, BuildRagDeps, BuildRagOptions, BuildSummary } from './types';

export type { BuildInputFile, BuildRagDeps, BuildRagOptions, BuildSummary } from './types';
export { resolveIncrementalFiles, resolveBuildResolution } from './incremental';

export const buildRAG = async (
  files: readonly BuildInputFile[],
  namespace: string,
  deps: BuildRagDeps,
  options: BuildRagOptions = {},
): Promise<BuildSummary> =>
  withNamespace(namespace, async () => {
    if (files.length === 0) {
      return { files: 0, parents: 0, edges: 0, claims: 0, communities: 0 };
    }

    const resolution = await resolveBuildResolution(
      files,
      namespace,
      deps,
      options.incremental ?? false,
    );

    if (resolution.filesToProcess.length === 0) {
      return {
        files: files.length,
        parents: 0,
        edges: 0,
        claims: 0,
        communities: 0,
        insertedFiles: 0,
        updatedFiles: 0,
        skippedFiles: resolution.skippedCount,
      };
    }

    if (resolution.parentIdsToPrune.length > 0 && deps.excludeFromCommunityDetection) {
      await deps.excludeFromCommunityDetection(resolution.parentIdsToPrune, namespace);
    }

    const splitResults = await Promise.all(
      resolution.filesToProcess.map((file) =>
        deps.split({ content: file.content, title: file.title, namespace }),
      ),
    );

    const graphStats = await persistSplitResults(splitResults, namespace, deps);
    const communities = await deps.detectCommunity({ persistCommunitySummaries: true, namespace });

    if (resolution.parentIdsToPrune.length > 0 && deps.pruneDocuments) {
      await deps.pruneDocuments(resolution.parentIdsToPrune, namespace);
    }

    return {
      files: files.length,
      ...graphStats,
      communities: communities.communities.length,
      insertedFiles: resolution.insertedCount,
      updatedFiles: resolution.updatedCount,
      skippedFiles: resolution.skippedCount,
    };
  });

export const buildIncrementalRAG = async (
  files: readonly BuildInputFile[],
  namespace: string,
  deps: BuildRagDeps,
): Promise<BuildSummary> => buildRAG(files, namespace, deps, { incremental: true });
