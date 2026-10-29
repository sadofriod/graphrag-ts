import { describe, expect, test } from 'bun:test';
import type { GraphDataset } from './datasets.ts';
import { authorizationFor, settleAmountFor } from './pricing.ts';

const dataset = (local: number, upto: number, base: number, perMapAnswer: number, scheme: 'exact' | 'upto' = 'upto'): GraphDataset => ({
  product: 'graph', id: 'dataset', workspaceId: 'workspace', title: 'Dataset', description: '', synthetic: true,
  license: { spdx: 'MIT', url: 'https://example.test/license' }, tags: [],
  pricing: {
    local: { usd: '', atomic: String(local) },
    global: {
      scheme, upto: { usd: '', atomic: String(upto) }, base: { usd: '', atomic: String(base) },
      perMapAnswer: { usd: '', atomic: String(perMapAnswer) },
    },
  },
});

describe('x402 pricing', () => {
  test('prices upto usage as base plus per-map usage, capped at authorization', () => {
    const priced = dataset(20, 100, 20, 10);
    expect(settleAmountFor(priced, 'global', 2)).toBe('40');
    expect(settleAmountFor(priced, 'global', 20)).toBe('100');
  });

  test('settlement never exceeds authorization for generated pricing cases', () => {
    for (let cap = 1; cap <= 12; cap++) {
      for (let base = 0; base <= cap; base++) {
        for (let perMap = 0; perMap <= 5; perMap++) {
          const priced = dataset(cap + 1, cap, base, perMap);
          for (let mapAnswers = 0; mapAnswers <= 20; mapAnswers++) {
            expect(BigInt(settleAmountFor(priced, 'global', mapAnswers)))
              .toBeLessThanOrEqual(BigInt(authorizationFor(priced, 'global')));
          }
        }
      }
    }
  });

  test('exact global and local modes charge their flat prices', () => {
    const priced = dataset(23, 101, 12, 7, 'exact');
    expect(authorizationFor(priced, 'local')).toBe('23');
    expect(authorizationFor(priced, 'global')).toBe('101');
    expect(settleAmountFor(priced, 'local', 9)).toBe('23');
    expect(settleAmountFor(priced, 'global', 9)).toBe('101');
  });
});
