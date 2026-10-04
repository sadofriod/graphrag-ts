import { estimateTokens } from '../../build/detectCommunity/summary/estimateTokens';

export interface CommunitySummaryInput {
  id: string;
  text: string;
}

export interface CommunitySummaryPart {
  communityId: string;
  part: number;
  text: string;
}

export interface SummaryBatch {
  content: string;
  communityIds: string[];
}

const shuffled = <T>(items: readonly T[], random: () => number): T[] => {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!];
  }
  return result;
};

const partHeader = (communityId: string, part: number): string =>
  `[Community ID: ${communityId} | summary part ${part}]\n`;

const fitsPromptBudget = (skeleton: string, content: string, budget: number): boolean =>
  estimateTokens(`${skeleton}\n${content}`) <= budget;

const splitSummary = (
  summary: CommunitySummaryInput,
  promptSkeleton: string,
  promptBudget: number,
): CommunitySummaryPart[] => {
  const characters = Array.from(summary.text);
  const parts: CommunitySummaryPart[] = [];
  let offset = 0;

  while (offset < characters.length) {
    let low = 1;
    let high = characters.length - offset;
    let bestLength = 0;

    while (low <= high) {
      const length = Math.floor((low + high) / 2);
      const text = characters.slice(offset, offset + length).join('');
      const candidate = `${partHeader(summary.id, 9_999_999)}${text}`;
      if (fitsPromptBudget(promptSkeleton, candidate, promptBudget)) {
        bestLength = length;
        low = length + 1;
      } else {
        high = length - 1;
      }
    }

    if (bestLength === 0) {
      throw new RangeError(`Map token budget is too small for community summary ${summary.id}.`);
    }

    parts.push({
      communityId: summary.id,
      part: parts.length + 1,
      text: characters.slice(offset, offset + bestLength).join(''),
    });
    offset += bestLength;
  }

  return parts;
};

const formatPart = ({ communityId, part, text }: CommunitySummaryPart): string =>
  `${partHeader(communityId, part)}${text}`;

export const buildSummaryBatches = (
  summaries: readonly CommunitySummaryInput[],
  promptSkeleton: string,
  promptBudget: number,
  random: () => number = Math.random,
): SummaryBatch[] => {
  if (!fitsPromptBudget(promptSkeleton, '', promptBudget)) {
    throw new RangeError('Map token budget cannot fit the Map prompt.');
  }

  const parts = shuffled(summaries, random)
    .flatMap((summary) => splitSummary(summary, promptSkeleton, promptBudget));
  const batches: SummaryBatch[] = [];
  let currentParts: string[] = [];
  let currentIds = new Set<string>();

  const flush = () => {
    if (currentParts.length === 0) {
      return;
    }
    batches.push({ content: currentParts.join('\n'), communityIds: [...currentIds] });
    currentParts = [];
    currentIds = new Set<string>();
  };

  for (const part of parts) {
    const formatted = formatPart(part);
    const candidate = [...currentParts, formatted].join('\n');
    if (!fitsPromptBudget(promptSkeleton, candidate, promptBudget)) {
      flush();
    }
    const singlePart = formatPart(part);
    if (!fitsPromptBudget(promptSkeleton, singlePart, promptBudget)) {
      throw new RangeError(`Map token budget cannot fit a summary part for ${part.communityId}.`);
    }
    currentParts.push(singlePart);
    currentIds.add(part.communityId);
  }

  flush();
  return batches;
};
