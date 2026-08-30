import { embedText } from './embedding';
import type { EntityAlias, EntityRecord } from '../types/graph';
import type { MatchedEntity } from '../types/retrieval';
import { cosineSimilarity, similarity } from '../utils/similarity';
import { reciprocalRankFusion } from '../utils/rrf';

const FUZZY_THRESHOLD = 0.4;
const SEMANTIC_THRESHOLD = 0.7;

const normalize = (text: string): string => text.trim().toLowerCase();

const queryTokens = (query: string): string[] =>
  query.toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fff]/g) ?? [];

export function matchExactEntity(
  query: string,
  entities: readonly EntityRecord[],
): MatchedEntity[] {
  const normalizedQuery = normalize(query);

  return entities
    .filter((entity) => {
      const name = normalize(entity.name);
      return name.length > 0 && normalizedQuery.includes(name);
    })
    .map((entity) => ({
      entityId: entity.id,
      name: entity.name,
      matchType: 'exact',
      score: 1,
    }));
}

export function matchAliasEntity(
  query: string,
  aliases: readonly EntityAlias[],
  entities: readonly EntityRecord[],
): MatchedEntity[] {
  const normalizedQuery = normalize(query);
  const entityNames = new Map(entities.map((entity) => [entity.id, entity.name]));
  const matched: MatchedEntity[] = [];
  const seen = new Set<string>();

  for (const alias of aliases) {
    const aliasName = normalize(alias.alias);
    if (aliasName.length === 0 || seen.has(alias.entityId)) {
      continue;
    }

    if (normalizedQuery.includes(aliasName)) {
      seen.add(alias.entityId);
      matched.push({
        entityId: alias.entityId,
        name: entityNames.get(alias.entityId) ?? alias.entityId,
        matchType: 'alias',
        score: 1,
      });
    }
  }

  return matched;
}

export function fuzzyMatchEntity(
  query: string,
  entities: readonly EntityRecord[],
): MatchedEntity[] {
  const tokens = queryTokens(query);
  const matched: MatchedEntity[] = [];

  for (const entity of entities) {
    let bestScore = 0;
    for (const token of tokens) {
      bestScore = Math.max(bestScore, similarity(entity.name, token));
    }

    if (bestScore >= FUZZY_THRESHOLD) {
      matched.push({
        entityId: entity.id,
        name: entity.name,
        matchType: 'fuzzy',
        score: bestScore,
      });
    }
  }

  return matched;
}

export async function semanticMatchEntity(
  query: string,
  entities: readonly EntityRecord[],
  threshold = SEMANTIC_THRESHOLD,
): Promise<MatchedEntity[]> {
  const queryVector = await embedText(query);
  const matched: MatchedEntity[] = [];

  for (const entity of entities) {
    const entityVector = await embedText(entity.name);
    const score = cosineSimilarity(queryVector, entityVector);

    if (score >= threshold) {
      matched.push({
        entityId: entity.id,
        name: entity.name,
        matchType: 'semantic',
        score,
      });
    }
  }

  return matched;
}

export function fuseMatchedEntitiesWithRRF(
  matchedChannels: readonly (readonly MatchedEntity[])[],
  k = 60,
): MatchedEntity[] {
  return reciprocalRankFusion(matchedChannels, (matched) => matched.entityId, k).map(
    ({ item, score }) => ({ ...item, score }),
  );
}

export async function matchEntitiesWithSemantic(
  query: string,
  entities: readonly EntityRecord[],
  aliases: readonly EntityAlias[],
  threshold = SEMANTIC_THRESHOLD,
): Promise<MatchedEntity[]> {
  const channels = [
    matchExactEntity(query, entities),
    matchAliasEntity(query, aliases, entities),
    fuzzyMatchEntity(query, entities),
    await semanticMatchEntity(query, entities, threshold),
  ];

  return fuseMatchedEntitiesWithRRF(channels);
}
