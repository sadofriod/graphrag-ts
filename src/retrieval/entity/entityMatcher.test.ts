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
  { id: 'e1', name: '苹果' },
  { id: 'e2', name: '香蕉' },
  { id: 'e3', name: '苹果公司' },
];

const aliases: EntityAlias[] = [
  { entityId: 'e1', alias: 'apple' },
  { entityId: 'e2', alias: 'banana' },
];

describe('matchExactEntity', () => {
  it('matches entity names contained in the query', () => {
    const result = matchExactEntity('苹果和香蕉的合作', entities);

    expect(result.map((matched) => matched.entityId)).toEqual(['e1', 'e2']);
    expect(result[0]?.matchType).toBe('exact');
    expect(result[0]?.score).toBe(1);
  });

  it('matches a full multi-char entity name inside the query', () => {
    const result = matchExactEntity('苹果公司怎么样', entities);

    expect(result.map((matched) => matched.entityId)).toEqual(['e1', 'e3']);
  });

  it('returns empty when nothing matches', () => {
    expect(matchExactEntity('天气', entities)).toEqual([]);
  });
});

describe('matchAliasEntity', () => {
  it('resolves an alias back to its entity name', () => {
    const result = matchAliasEntity('我喜欢 apple', aliases, entities);

    expect(result).toEqual([{ entityId: 'e1', name: '苹果', matchType: 'alias', score: 1 }]);
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
    const result = fuzzyMatchEntity('苹苹', entities);

    expect(result.map((matched) => matched.entityId)).toEqual(['e1']);
    expect(result[0]?.matchType).toBe('fuzzy');
    expect(result[0]?.score).toBe(0.5);
  });

  it('excludes entities below the threshold', () => {
    expect(fuzzyMatchEntity('无关', entities)).toEqual([]);
  });
});

describe('semanticMatchEntity', () => {
  it('matches entities whose embeddings are close to the query', async () => {
    const originalModels = modelLoaderSingleton.models;
    const vectorMap: Record<string, number[]> = {
      '苹果': [1, 0],
      '香蕉': [0, 1],
      '苹果公司': [0.8, 0.6],
    };

    modelLoaderSingleton.models = {
      embedding: { embedQuery: async (text: string) => vectorMap[text] ?? [0, 0] },
      slice: {},
    } as never;

    try {
      const result = await semanticMatchEntity('苹果', entities);

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
      '苹果': [1, 0],
      '苹果公司': [0.8, 0.6],
    };

    modelLoaderSingleton.models = {
      embedding: { embedQuery: async (text: string) => vectorMap[text] ?? [0, 0] },
      slice: {},
    } as never;

    try {
      const result = await semanticMatchEntity('苹果', entities, 0.9);

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
      '苹果': [1, 0],
      '香蕉': [0, 1],
      '苹果公司': [0.8, 0.6],
    };

    modelLoaderSingleton.models = {
      embedding: { embedQuery: async (text: string) => vectorMap[text] ?? [0, 0] },
      slice: {},
    } as never;

    try {
      const result = await matchEntitiesWithSemantic('苹果', entities, aliases);

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
      { entityId: 'e1', name: '苹果', matchType: 'exact', score: 1 },
      { entityId: 'e2', name: '香蕉', matchType: 'exact', score: 1 },
    ];
    const alias: MatchedEntity[] = [
      { entityId: 'e2', name: '香蕉', matchType: 'alias', score: 1 },
      { entityId: 'e3', name: '苹果公司', matchType: 'alias', score: 1 },
    ];

    const result = fuseMatchedEntitiesWithRRF([exact, alias]);

    expect(result.map((matched) => matched.entityId)).toEqual(['e2', 'e1', 'e3']);
    expect(result[0]?.score).toBeCloseTo(1 / 61 + 1 / 62);
    expect(result[1]?.score).toBeCloseTo(1 / 61);
    expect(result[2]?.score).toBeCloseTo(1 / 62);
  });
});
