import { buildRAG, type BuildInputFile, type BuildSummary } from './buildRag';
import type { BuildRegistry } from './buildRegistry';
import { withNamespace } from '../namespace/namespaceContext';

export interface StartBuildOptions {
  runner?: (files: readonly BuildInputFile[], namespace: string) => Promise<BuildSummary>;
}

export const startBuild = (
  files: readonly BuildInputFile[],
  registry: BuildRegistry,
  namespace: string,
  options: StartBuildOptions = {},
): string => {
  const { runner = buildRAG } = options;
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
