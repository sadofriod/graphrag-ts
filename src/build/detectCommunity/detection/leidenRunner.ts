import { groupByCommunity } from './groupByCommunity';
import { createCommunityHierarchyBuilder } from './communityHierarchy';
import { loadIgraph } from '../graph/igraphLoader';
import { loadCommunityGraph } from '../graph/loadCommunityGraph';
import { persistCommunitySummaries } from '../summary/persistCommunitySummaries';
import { toWeightedEdgePairs } from '../graph/toWeightedEdgePairs';
import { withNamespace } from '../../../namespace/namespaceContext';
import type { Community, CommunityDetectionResult, LeidenResult, WeightedGraphEdge } from '../types';

const runLeidenPartition = async (
  WasmGraph: Awaited<ReturnType<typeof loadIgraph>>,
  graphEdges: WeightedGraphEdge[],
): Promise<{ communities: Community[]; membership: number[]; score?: number }> => {
  const vertexOrder = Array.from(new Set(graphEdges.flatMap(({ source, target }) => [source, target])));
  const graph = WasmGraph.fromEdges(toWeightedEdgePairs([...graphEdges]), false);

  try {
    const raw = graph.leiden();
    const resultPayload = JSON.parse(raw) as LeidenResult;

    return {
      membership: resultPayload.membership,
      communities: groupByCommunity(resultPayload, vertexOrder),
      score: Number(resultPayload.quality),
    };
  } finally {
    graph.free();
  }
};

export const detectCommunity = async ({
  edges,
  persistCommunitySummaries: shouldPersistCommunitySummaries = false,
  namespace,
}: {
  edges?: WeightedGraphEdge[];
  persistCommunitySummaries?: boolean;
  namespace: string;
}): Promise<CommunityDetectionResult> =>
  withNamespace(namespace, async () => {
    const graphEdges = edges ?? (await loadCommunityGraph(namespace)).edges;

    if (graphEdges.length === 0) {
      return { algorithm: 'leiden', communities: [], membership: [] };
    }

    const WasmGraph = await loadIgraph();
    const rootPartition = await runLeidenPartition(WasmGraph, graphEdges);
    const hierarchy = await createCommunityHierarchyBuilder(async (edges) =>
      (await runLeidenPartition(WasmGraph, edges)).communities
    )(graphEdges, rootPartition.communities);
    const result: CommunityDetectionResult = {
      algorithm: 'leiden',
      membership: rootPartition.membership,
      communities: rootPartition.communities,
      hierarchy,
      ...(rootPartition.score !== undefined ? { score: rootPartition.score } : {}),
    };

    if (shouldPersistCommunitySummaries) {
      await persistCommunitySummaries(result, namespace);
    }

    return result;
  });
