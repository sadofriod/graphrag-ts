import type { BuildInputFile, BuildRagDeps, IncrementalResolution } from './types';

export const createNonIncrementalResolution = (files: readonly BuildInputFile[]): IncrementalResolution => ({
  filesToProcess: files,
  insertedCount: files.length,
  updatedCount: 0,
  skippedCount: 0,
  parentIdsToPrune: [],
});

const getParentIdsToPrune = (
  diff: Awaited<ReturnType<NonNullable<BuildRagDeps['diffDocuments']>>>,
): readonly string[] => diff.toUpdate.flatMap((item) => item.existingParentIds ?? (
  item.existingParentId ? [item.existingParentId] : []
));

export const resolveIncrementalFiles = async (
  files: readonly BuildInputFile[],
  namespace: string,
  deps: BuildRagDeps,
): Promise<IncrementalResolution> => {
  if (!deps.diffDocuments) {
    return createNonIncrementalResolution(files);
  }

  const diff = await deps.diffDocuments(files, namespace);
  const parentIdsToPrune = getParentIdsToPrune(diff);
  const filesToProcess = [
    ...diff.toInsert.map((item) => item.file),
    ...diff.toUpdate.map((item) => item.file),
  ];

  return {
    filesToProcess,
    insertedCount: diff.toInsert.length,
    updatedCount: diff.toUpdate.length,
    skippedCount: diff.toSkip.length,
    parentIdsToPrune,
  };
};

export const resolveBuildResolution = async (
  files: readonly BuildInputFile[],
  namespace: string,
  deps: BuildRagDeps,
  incremental: boolean,
): Promise<IncrementalResolution> => {
  if (!incremental) {
    return createNonIncrementalResolution(files);
  }

  return resolveIncrementalFiles(files, namespace, deps);
};
