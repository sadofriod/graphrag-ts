import { agentRegistry } from '../../build/agents.md/agentRegistry';
import { assmblyAgent } from '../../build/agents.md/assmblyAgent';
import { invokeSliceModel } from '../llm';
import type { EvidenceSnippet } from '../types/graph';

export async function generateAnswer(
  query: string,
  communitySummaries: readonly string[],
  evidence: readonly EvidenceSnippet[],
): Promise<string> {
  const context = [
    '[Community summaries]',
    ...communitySummaries,
    '[Evidence]',
    ...evidence.map((snippet, index) => `${index + 1}. ${snippet.text}`),
  ].join('\n');
  const prompt = await assmblyAgent(
    { query, content: context },
    agentRegistry.answerGeneration,
  );

  return (await invokeSliceModel(prompt)).trim();
}
