import type { BenchmarkExpectation } from './dataset';

/**
 * Recall evaluation: compare retrieval context against expectations (entities + key phrases).
 *
 * - entityRecall: share of expected entities that appear in the context
 * - phraseRecall: share of expected key phrases that appear in the context (exact substring)
 * - combinedRecall: recall over entities + phrases after merging them
 * - hit: strict hit (all expectations appear)
 *
 * An empty expectation set is treated as 1.0 (nothing is missing).
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
