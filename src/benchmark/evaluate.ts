import type { BenchmarkExpectation } from './dataset';

/**
 * 召回率评估：把检索上下文与期望（实体 + 关键短语）比对。
 *
 * - entityRecall：期望实体在上下文中出现的比例
 * - phraseRecall：期望关键短语在上下文中出现的比例（精确子串）
 * - combinedRecall：实体 + 短语合并后的召回比例
 * - hit：严格命中（期望全部出现）
 *
 * 空期望集合视为 1.0（无缺失项）。
 */

export interface QueryEvaluation {
  foundEntities: string[];
  missingEntities: string[];
  foundPhrases: string[];
  missingPhrases: string[];
  entityRecall: number;
  phraseRecall: number;
  combinedRecall: number;
  hit: boolean;
}

const findPresent = (needles: readonly string[], haystack: string): string[] =>
  needles.filter((needle) => haystack.includes(needle));

const findMissing = (needles: readonly string[], haystack: string): string[] =>
  needles.filter((needle) => !haystack.includes(needle));

const ratio = (found: number, total: number): number => (total === 0 ? 1 : found / total);

export const evaluateRecall = (
  context: string,
  expectation: BenchmarkExpectation,
): QueryEvaluation => {
  const foundEntities = findPresent(expectation.entities, context);
  const foundPhrases = findPresent(expectation.phrases, context);

  const entityRecall = ratio(foundEntities.length, expectation.entities.length);
  const phraseRecall = ratio(foundPhrases.length, expectation.phrases.length);
  const combinedRecall = ratio(
    foundEntities.length + foundPhrases.length,
    expectation.entities.length + expectation.phrases.length,
  );

  return {
    foundEntities,
    missingEntities: findMissing(expectation.entities, context),
    foundPhrases,
    missingPhrases: findMissing(expectation.phrases, context),
    entityRecall,
    phraseRecall,
    combinedRecall,
    hit: entityRecall === 1 && phraseRecall === 1,
  };
};
