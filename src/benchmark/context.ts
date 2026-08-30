import type { RetrievalResult } from '../retrieval/types/retrieval';

/**
 * 从检索 API 响应中提取可匹配的上下文文本：
 * - 每个命中社区的 name / members / summary
 * - 每条 evidence 的 text（原文子块，recall 的主要依据）
 * - 可选：answer（LLM 生成的回答）
 *
 * 召回率默认只看「检索上下文」（社区 + 证据），不包含 answer，
 * 以避免把生成质量混入检索召回率；需要端到端口径时可通过
 * `includeAnswer: true` 打开。
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
