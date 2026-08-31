import { describe, expect, it } from 'bun:test';

import { modelLoaderSingleton } from '../../build/modelLoader';
import type { EntityAlias, EntityRecord } from '../types/graph';
import type { MatchedEntity } from '../types/retrieval';
import {
  fuzzyMatchEntity,
  fuseMatchedEntitiesWithRRF,
  matchAliasEntity,
  matchEntitiesWithSemantic,
  matchExactEntity,
  semanticMatchEntity,
} from './entityMatcher';

const entities: EntityRecord[] = [
  { id: 'e1', name: 'Apple' },
  { id: 'e2', name: 'Banana' },
  { id: 'e3', name: 'Apple Inc.' },
];

const aliases: EntityAlias[] = [
  { entityId: 'e1', alias: 'apple' },
  { entityId: 'e2', alias: 'banana' },
];

describe('matchExactEntity', () => {
  it('matches entity names contained in the query', () => {
    const result = matchExactEntity('Apple and Banana partnership', entities);

    expect(result.map((matched) => matched.entityId)).toEqual(['e1', 'e2']);
    expect(result[0]?.matchType).toBe('exact');
    expect(result[0]?.score).toBe(1);
  });

  it('matches a full multi-char entity name inside the query', () => {
    const result = matchExactEntity('How is Apple Inc. doing', entities);

    expect(result.map((matched) => matched.entityId)).toEqual(['e1', 'e3']);
  });

  it('returns empty when nothing matches', () => {
    expect(matchExactEntity('weather', entities)).toEqual([]);
  });
});

describe('matchAliasEntity', () => {
  it('resolves an alias back to its entity name', () => {
    const result = matchAliasEntity('I like apple', aliases, entities);

    expect(result).toEqual([{ entityId: 'e1', name: 'Apple', matchType: 'alias', score: 1 }]);
  });

  it('deduplicates when multiple aliases of one entity match', () => {
    const multi: EntityAlias[] = [
      { entityId: 'e1', alias: 'apple' },
      { entityId: 'e1', alias: 'aipen' },
    ];
    const result = matchAliasEntity('apple', multi, entities);

    expect(result).toHaveLength(1);
    expect(result[0]?.entityId).toBe('e1');
  });
});

describe('fuzzyMatchEntity', () => {
  it('matches entities above the similarity threshold', () => {
    const result = fuzzyMatchEntity('Appl', entities);

    expect(result.map((matched) => matched.entityId)).toEqual(['e1']);
    expect(result[0]?.matchType).toBe('fuzzy');
    expect(result[0]?.score).toBe(0.5);
  });

  it('excludes entities below the threshold', () => {
    expect(fuzzyMatchEntity('irrelevant', entities)).toEqual([]);
  });
});

describe('semanticMatchEntity', () => {
  it('matches entities whose embeddings are close to the query', async () => {
    const originalModels = modelLoaderSingleton.models;
    const vectorMap: Record<string, number[]> = {
      'Apple': [1, 0],
      'Banana': [0, 1],
      'Apple Inc.': [0.8, 0.6],
    };

    modelLoaderSingleton.models = {
      embedding: { embedQuery: async (text: string) => vectorMap[text] ?? [0, 0] },
      slice: {},
    } as never;

    try {
      const result = await semanticMatchEntity('Apple', entities);

      expect(result.map((matched) => matched.entityId)).toEqual(['e1', 'e3']);
      expect(result[0]?.matchType).toBe('semantic');
      expect(result[0]?.score).toBeCloseTo(1);
      expect(result[1]?.score).toBeCloseTo(0.8);
    } finally {
      modelLoaderSingleton.models = originalModels;
    }
  });

  it('respects the similarity threshold', async () => {
    const originalModels = modelLoaderSingleton.models;
    const vectorMap: Record<string, number[]> = {
      'Apple': [1, 0],
      'Apple Inc.': [0.8, 0.6],
    };

    modelLoaderSingleton.models = {
      embedding: { embedQuery: async (text: string) => vectorMap[text] ?? [0, 0] },
      slice: {},
    } as never;

    try {
      const result = await semanticMatchEntity('Apple', entities, 0.9);

      expect(result.map((matched) => matched.entityId)).toEqual(['e1']);
    } finally {
      modelLoaderSingleton.models = originalModels;
    }
  });
});

describe('matchEntitiesWithSemantic', () => {
  it('fuses all four channels including semantic', async () => {
    const originalModels = modelLoaderSingleton.models;
    const vectorMap: Record<string, number[]> = {
      'Apple': [1, 0],
      'Banana': [0, 1],
      'Apple Inc.': [0.8, 0.6],
    };

    modelLoaderSingleton.models = {
      embedding: { embedQuery: async (text: string) => vectorMap[text] ?? [0, 0] },
      slice: {},
    } as never;

    try {
      const result = await matchEntitiesWithSemantic('Apple', entities, aliases);

      expect(result.map((matched) => matched.entityId)).toEqual(['e1', 'e3']);
      expect(result[0]?.matchType).toBe('exact');
    } finally {
      modelLoaderSingleton.models = originalModels;
    }
  });
});

describe('fuseMatchedEntitiesWithRRF', () => {
  it('fuses channels and ranks multi-channel hits higher', () => {
    const exact: MatchedEntity[] = [
      { entityId: 'e1', name: 'Apple', matchType: 'exact', score: 1 },
      { entityId: 'e2', name: 'Banana', matchType: 'exact', score: 1 },
    ];
    const alias: MatchedEntity[] = [
      { entityId: 'e2', name: 'Banana', matchType: 'alias', score: 1 },
      { entityId: 'e3', name: 'Apple Inc.', matchType: 'alias', score: 1 },
    ];

    const result = fuseMatchedEntitiesWithRRF([exact, alias]);

    expect(result.map((matched) => matched.entityId)).toEqual(['e2', 'e1', 'e3']);
    expect(result[0]?.score).toBeCloseTo(1 / 61 + 1 / 62);
    expect(result[1]?.score).toBeCloseTo(1 / 61);
    expect(result[2]?.score).toBeCloseTo(1 / 62);
  });
});
