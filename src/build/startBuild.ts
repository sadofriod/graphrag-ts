import {
  buildRAG,
  type BuildInputFile,
  type BuildRagOptions,
  type BuildSummary,
} from './buildRag';
import type { BuildRegistry } from './buildRegistry';
import {
  deleteDocumentByParentId,
  deleteDocumentByTitle,
  type PruneDocumentResult,
} from './incremental/documentPruner';
import { withNamespace } from '../namespace/namespaceContext';

export interface StartBuildOptions extends BuildRagOptions {
  runner?: (files: readonly BuildInputFile[], namespace: string) => Promise<BuildSummary>;
}

export interface DeleteDocumentInput {
  readonly title?: string;
  readonly parentId?: string;
  readonly namespace: string;
}

export const startBuild = (
  files: readonly BuildInputFile[],
  registry: BuildRegistry,
  namespace: string,
  options: StartBuildOptions = {},
): string => {
  const { runner = (f, ns) => buildRAG(f, ns, undefined, { incremental: options.incremental }) } = options;
  const title = files.length === 1 ? (files[0]?.title ?? 'untitled') : `${files.length} files`;
  const id = registry.create({ title, namespace });

  void (async () => {
    registry.update(id, { status: 'running' });
    try {
      await withNamespace(namespace, () => runner(files, namespace));
      registry.update(id, { status: 'succeeded', finishedAt: Date.now() });
    } catch (error) {
      registry.update(id, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        finishedAt: Date.now(),
      });
    }
  })();

  return id;
};

export const startIncrementalBuild = (
  files: readonly BuildInputFile[],
  registry: BuildRegistry,
  namespace: string,
  options: Omit<StartBuildOptions, 'incremental'> = {},
): string => startBuild(files, registry, namespace, { ...options, incremental: true });

export const deleteRAGDocument = async (
  input: DeleteDocumentInput,
): Promise<PruneDocumentResult> => {
  if (input.parentId) {
    return deleteDocumentByParentId(input.parentId, input.namespace);
  }
  if (input.title) {
    return deleteDocumentByTitle(input.title, input.namespace);
  }
  return { deletedParents: 0, deletedClaims: 0 };
};
