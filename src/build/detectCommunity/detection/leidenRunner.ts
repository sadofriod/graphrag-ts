import { groupByCommunity } from './groupByCommunity';
import { loadIgraph } from '../graph/igraphLoader';
import { loadCommunityGraph } from '../graph/loadCommunityGraph';
import { persistCommunitySummaries } from '../summary/persistCommunitySummaries';
import { toWeightedEdgePairs } from '../graph/toWeightedEdgePairs';
import type { CommunityDetectionResult, LeidenResult, WeightedGraphEdge } from '../types';

export const detectCommunity = async ({
  edges,
  persistCommunitySummaries: shouldPersistCommunitySummaries = false,
  namespace,
}: {
  edges?: WeightedGraphEdge[];
  persistCommunitySummaries?: boolean;
  namespace: string;
}): Promise<CommunityDetectionResult> => {
  const graphEdges = edges ?? (await loadCommunityGraph()).edges;

  if (graphEdges.length === 0) {
    return { algorithm: 'leiden', communities: [], membership: [] };
  }

  const WasmGraph = await loadIgraph();
  const vertexOrder = Array.from(new Set(graphEdges.flatMap(({ source, target }) => [source, target])));
  const graph = WasmGraph.fromEdges(toWeightedEdgePairs(graphEdges), false);

  try {
    const raw = graph.leiden();
    const resultPayload = JSON.parse(raw) as LeidenResult;
    const result: CommunityDetectionResult = {
      algorithm: 'leiden',
      membership: resultPayload.membership,
      communities: groupByCommunity(resultPayload, vertexOrder),
      score: Number(resultPayload.quality),
    };

    if (shouldPersistCommunitySummaries) {
      await persistCommunitySummaries(result, namespace);
    }

    return result;
  } finally {
    graph.free();
  }
};
