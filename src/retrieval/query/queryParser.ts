import { agentRegistry } from '../../build/agents.md/agentRegistry';
import { assmblyAgent } from '../../build/agents.md/assmblyAgent';
import { parseLlmJson } from '../../helper/parseLlmJson';
import { invokeSliceModel } from '../llm';
import type { QueryIntent } from '../types/retrieval';

export async function parseQuery(query: string): Promise<QueryIntent> {
  const prompt = await assmblyAgent({ query }, agentRegistry.queryIntent);
  const raw = await invokeSliceModel(prompt);
  const parsed = parseLlmJson<Partial<QueryIntent>>(raw);

  return {
    rawQuery: query,
    entities: parsed.entities ?? [],
    keywords: parsed.keywords ?? [],
    themes: parsed.themes ?? [],
  };
}
