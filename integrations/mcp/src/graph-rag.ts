import {
  createBuildRegistry,
  startBuild,
  GraphRAGRetrievalService,
  type BuildInputFile,
} from '@ashes_born/graph-rag-ts';
import { withNamespace } from '@ashes_born/graph-rag-ts/namespace/namespaceContext';
import { setTimeout as delay } from 'node:timers/promises';

const retrievalService = new GraphRAGRetrievalService();

export const buildSnapshot = async (
  files: readonly BuildInputFile[],
  namespace: string,
): Promise<void> => {
  const registry = createBuildRegistry();
  const buildId = startBuild(files, registry, namespace);

  while (true) {
    const job = registry.get(buildId);
    if (!job) {
      throw new Error('GraphRAG did not register the build job.');
    }
    if (job.status === 'succeeded') {
      return;
    }
    if (job.status === 'failed') {
      throw new Error(job.error ?? 'GraphRAG build failed.');
    }
    await delay(250);
  }
};

export const retrieve = async (
  query: string,
  namespace: string,
  topK: number,
  communityLevel?: number,
) =>
  withNamespace(namespace, () => retrievalService.retrieve({
    query,
    topK,
    ...(communityLevel === undefined ? {} : { options: { communityLevel } }),
  }));

export const retrieveGlobal = async (query: string, namespace: string, communityLevel?: number) =>
  withNamespace(namespace, () => retrievalService.retrieveGlobal({
    query,
    ...(communityLevel === undefined ? {} : { options: { communityLevel } }),
  }));