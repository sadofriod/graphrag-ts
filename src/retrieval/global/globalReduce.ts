import { agentRegistry } from '../../build/agents.md/agentRegistry';
import { assmblyAgent } from '../../build/agents.md/assmblyAgent';
import { estimateTokens } from '../../build/detectCommunity/summary/estimateTokens';
import { parseLlmJson } from '../../helper/parseLlmJson';
import { invokeSliceModel } from '../llm';
import type { GlobalMapAnswer } from '../types/retrieval';
import { awaitRetrieval } from '../retrievalContext';

export interface GlobalReduceResult {
  answer: string;
  promptTokens: number;
}

const formatAnswer = (answer: GlobalMapAnswer): string =>
  `[Usefulness: ${answer.usefulness}; Community IDs: ${answer.communityIds.join(', ')}]\n${answer.answer}`;

export const selectGlobalReduceAnswers = (
  answers: readonly GlobalMapAnswer[],
  promptSkeleton: string,
  promptBudget: number,
): GlobalMapAnswer[] => {
  const ranked = answers
    .filter((answer) => answer.usefulness > 0)
    .map((answer, index) => ({ answer, index }))
    .sort((left, right) =>
      right.answer.usefulness - left.answer.usefulness || left.index - right.index,
    );
  const selected: GlobalMapAnswer[] = [];
  let context = '';

  for (const { answer } of ranked) {
    const candidate = [context, formatAnswer(answer)].filter(Boolean).join('\n\n');
    if (estimateTokens(`${promptSkeleton}\n${candidate}`) > promptBudget) {
      continue;
    }
    selected.push(answer);
    context = candidate;
  }

  return selected;
};

export const parseGlobalReduceOutput = (raw: string): string => {
  const parsed = parseLlmJson<unknown>(raw);
  if (typeof parsed !== 'object' || parsed === null || !('answer' in parsed)) {
    throw new Error('Global Reduce output must contain an answer field.');
  }
  if (typeof parsed.answer !== 'string' || !parsed.answer.trim()) {
    throw new Error('Global Reduce output contains an invalid answer.');
  }
  return parsed.answer.trim();
};

export const generateGlobalReduceAnswer = async (
  query: string,
  answers: readonly GlobalMapAnswer[],
): Promise<GlobalReduceResult> => {
  const content = answers.map(formatAnswer).join('\n\n');
  const prompt = await awaitRetrieval(() => assmblyAgent({ query, content }, agentRegistry.globalReduce));
  const raw = await invokeSliceModel(prompt);
  return { answer: parseGlobalReduceOutput(raw), promptTokens: estimateTokens(prompt) };
};
