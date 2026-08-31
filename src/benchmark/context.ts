import type { RetrievalResult } from '../retrieval/types/retrieval';

/**
 * Extract matchable context text from a retrieval API response:
 * - name / members / summary for each hit community
 * - the text of each evidence item (source child chunk, the main basis for recall)
 * - optionally, answer (the LLM-generated answer)
 *
 * Recall looks only at the retrieval context by default (communities + evidence), excluding answer,
 * to avoid mixing generation quality into retrieval recall; enable end-to-end evaluation via
 * `includeAnswer: true`.
 */

export interface RetrievedContextOptions {
  includeAnswer?: boolean;
}

const pushIfPresent = (parts: string[], text: string | undefined): void => {
  if (typeof text === 'string' && text.length > 0) {
    parts.push(text);
  }
};

export const buildRetrievedContext = (
  result: RetrievalResult,
  options: RetrievedContextOptions = {},
): string => {
  const parts: string[] = [];

  for (const community of result.communities) {
    pushIfPresent(parts, community.name);
    for (const member of community.members) {
      pushIfPresent(parts, member);
    }
    pushIfPresent(parts, community.summary);
  }

  for (const snippet of result.evidence) {
    pushIfPresent(parts, snippet.text);
  }

  if (options.includeAnswer === true) {
    pushIfPresent(parts, result.answer);
  }

  return parts.join('\n');
};
