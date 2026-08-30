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
    '【社区摘要】',
    ...communitySummaries,
    '【证据】',
    ...evidence.map((snippet, index) => `${index + 1}. ${snippet.text}`),
  ].join('\n');
  const prompt = await assmblyAgent(
    { query, content: context },
    agentRegistry.answerGeneration,
  );

  return (await invokeSliceModel(prompt)).trim();
}
