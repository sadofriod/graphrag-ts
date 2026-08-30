import { agentRegistry } from '../../build/agents.md/agentRegistry';
import { assmblyAgent } from '../../build/agents.md/assmblyAgent';
import { parseLlmJson } from '../../helper/parseLlmJson';
import { invokeSliceModel } from '../llm';
import type { CommunityHit, RankedCommunity } from '../types/retrieval';

export async function llmFilterCommunities(
  query: string,
  communities: readonly RankedCommunity[],
): Promise<CommunityHit[]> {
  const candidates = communities
    .map((community) => `${community.id}: ${community.summary ?? ''}`)
    .join('\n');
  const prompt = await assmblyAgent(
    { query, content: candidates },
    agentRegistry.communityFilter,
  );
  const raw = await invokeSliceModel(prompt);
  const parsed = parseLlmJson<{ selectedCommunityIds?: string[] }>(raw);
  const selected = new Set(parsed.selectedCommunityIds ?? []);

  return communities.filter((community) => selected.has(community.id));
}

export async function selectFinalCommunities(
  query: string,
  rankedCommunities: readonly RankedCommunity[],
  llmSelect = false,
): Promise<CommunityHit[]> {
  if (llmSelect) {
    return llmFilterCommunities(query, rankedCommunities);
  }

  return [...rankedCommunities];
}
