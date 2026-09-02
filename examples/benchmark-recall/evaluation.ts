import type { RecallExpectation, RetrievedContextOptions } from './types';
import type { RetrievalResult } from '../../src/retrieval/types/retrieval';

const expandContractions = (text: string): string =>
  text
    .replace(/\b(it|that|there|what|who|where|when|why|how|let|i|you|we|they|he|she|this)\s*['’]s\b/gi, '$1 is')
    .replace(/\b(\w+)\s*['’]re\b/gi, '$1 are')
    .replace(/\b(\w+)\s*['’]ve\b/gi, '$1 have')
    .replace(/\b(\w+)\s*['’]ll\b/gi, '$1 will')
    .replace(/\b(\w+)\s*['’]d\b/gi, '$1 would')
    .replace(/\b(\w+)\s*['’]m\b/gi, '$1 am')
    .replace(/\bcan\s*['’]t\b/gi, 'can not')
    .replace(/\bwon\s*['’]t\b/gi, 'will not')
    .replace(/\bshan\s*['’]t\b/gi, 'shall not')
    .replace(/\bain\s*['’]t\b/gi, 'is not');

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'be',
  'but',
  'by',
  'for',
  'from',
  'he',
  'her',
  'his',
  'i',
  'in',
  'into',
  'is',
  'it',
  'of',
  'on',
  'or',
  'she',
  'that',
  'the',
  'their',
  'them',
  'they',
  'this',
  'to',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'who',
  'why',
  'with',
  'you',
  'your',
]);

const TOKEN_ALIASES: Record<string, readonly string[]> = {
  despair: ['despair', 'desperate'],
  desperate: ['desperate', 'despair'],
  wretchedness: ['wretchedness', 'wretched'],
  wretched: ['wretched', 'wretchedness'],
  mighty: ['mighty', 'great'],
  great: ['great', 'mighty'],
  companion: ['companion', 'partner'],
  partner: ['partner', 'companion'],
  identity: ['identity', 'self'],
  self: ['self', 'identity'],
  female: ['female', 'woman', 'girl'],
  woman: ['woman', 'female'],
  girl: ['girl', 'female'],
  burden: ['burden', 'weight'],
  weight: ['weight', 'burden'],
  knowledge: ['knowledge', 'wisdom'],
  wisdom: ['wisdom', 'knowledge'],
  execution: ['execution', 'sentence'],
  sentence: ['sentence', 'execution'],
};

const normalizeText = (text: string): string =>
  expandContractions(text)
    .toLocaleLowerCase()
    .normalize('NFKC')
    .replace(/['’]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const canonicalizeToken = (token: string): readonly string[] => {
  const normalized = token.trim();
  if (!normalized || STOPWORDS.has(normalized)) {
    return [];
  }

  return TOKEN_ALIASES[normalized] ?? [normalized];
};

const tokenize = (text: string): string[] =>
  normalizeText(text)
    .split(' ')
    .filter(Boolean)
    .flatMap((token) => canonicalizeToken(token));

const includesTokenSequence = (haystack: string, needle: string): boolean => {
  const haystackTokens = tokenize(haystack);
  const needleTokens = tokenize(needle);

  if (needleTokens.length === 0) {
    return true;
  }
  if (needleTokens.length === 1) {
    const [needleToken] = needleTokens;
    return needleToken !== undefined && haystackTokens.includes(needleToken);
  }

  let matchIndex = 0;
  for (const token of haystackTokens) {
    if (token === needleTokens[matchIndex]) {
      matchIndex += 1;
      if (matchIndex === needleTokens.length) {
        return true;
      }
    }
  }

  return false;
};

const includesText = (haystack: string, needle: string): boolean => {
  const normalizedHaystack = normalizeText(haystack);
  const normalizedNeedle = normalizeText(needle);

  if (!normalizedNeedle) {
    return true;
  }

  const haystackTokens = tokenize(haystack);
  const needleTokens = tokenize(needle);
  const overlap = needleTokens.filter((token) => haystackTokens.includes(token)).length;
  const overlapRatio = needleTokens.length === 0 ? 1 : overlap / needleTokens.length;

  return (
    normalizedHaystack.includes(normalizedNeedle) ||
    includesTokenSequence(normalizedHaystack, normalizedNeedle) ||
    overlapRatio >= 0.75
  );
};

const findPresent = (needles: readonly string[], haystack: string): string[] =>
  needles.filter((needle) => includesText(haystack, needle));

const findMissing = (needles: readonly string[], haystack: string): string[] =>
  needles.filter((needle) => !includesText(haystack, needle));

const ratio = (found: number, total: number): number => (total === 0 ? 1 : found / total);

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
    parts.push(...community.members);
    pushIfPresent(parts, community.summary);
  }

  parts.push(...result.evidence.map((snippet) => snippet.text));

  if (options.includeAnswer === true) {
    pushIfPresent(parts, result.answer);
  }

  return parts.join('\n');
};

export const evaluateRecall = (context: string, expectation: RecallExpectation) => {
  const foundEntities = findPresent(expectation.entities, context);
  const foundPhrases = findPresent(expectation.phrases, context);
  const entityRecall = ratio(foundEntities.length, expectation.entities.length);
  const phraseRecall = ratio(foundPhrases.length, expectation.phrases.length);

  return {
    foundEntities,
    missingEntities: findMissing(expectation.entities, context),
    foundPhrases,
    missingPhrases: findMissing(expectation.phrases, context),
    entityRecall,
    phraseRecall,
    combinedRecall: ratio(
      foundEntities.length + foundPhrases.length,
      expectation.entities.length + expectation.phrases.length,
    ),
    hit: entityRecall === 1 && phraseRecall === 1,
  };
};