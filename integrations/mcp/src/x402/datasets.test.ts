import { describe, expect, test } from 'bun:test';
import { datasetRegistrySchema, parseDatasetRegistry, parseUsdToAtomic } from './datasets.ts';

const example = {
  datasets: [{
    id: 'web3-security',
    workspace_id: 'web3-security',
    title: 'Synthetic smart-contract security relations',
    description: 'Graph over a synthetic audit corpus.',
    synthetic: true,
    license: { spdx: 'MIT', url: 'https://example.com/license' },
    pricing: { local: '$0.02', global: { upto: '$0.10', base: '$0.02', per_map_answer: '$0.01' } },
    tags: ['graphrag', 'security'],
  }],
};

describe('x402 dataset registry', () => {
  test('parses USD values as exact 6-decimal atomic units', () => {
    expect(parseUsdToAtomic('$0.02')).toBe('20000');
    expect(parseUsdToAtomic('0.02')).toBe('20000');
    expect(parseUsdToAtomic('$1')).toBe('1000000');
    expect(parseUsdToAtomic('$0.000001')).toBe('1');
    for (const invalid of ['$0.0000001', '-$1', '1e-6', '', '$']) expect(() => parseUsdToAtomic(invalid)).toThrow();
  });

  test('rejects duplicate ids and workspaces', () => {
    const duplicateId = { datasets: [...example.datasets, { ...example.datasets[0]!, workspace_id: 'another' }] };
    const duplicateWorkspace = { datasets: [...example.datasets, { ...example.datasets[0]!, id: 'another' }] };
    expect(() => datasetRegistrySchema.parse(duplicateId)).toThrow();
    expect(() => datasetRegistrySchema.parse(duplicateWorkspace)).toThrow();
  });

  test('rejects unknown fields and prices where upto is below base', () => {
    expect(() => datasetRegistrySchema.parse({ ...example, extra: true })).toThrow();
    expect(() => datasetRegistrySchema.parse({ datasets: [{ ...example.datasets[0]!, database: 'secret' }] })).toThrow();
    expect(() => datasetRegistrySchema.parse({ datasets: [{ ...example.datasets[0]!, pricing: {
      ...example.datasets[0]!.pricing, global: { ...example.datasets[0]!.pricing.global, upto: '$0.01' },
    } }] })).toThrow();
  });

  test('parses the valid spec example and retains display and atomic prices', () => {
    const parsed = parseDatasetRegistry(example);
    expect(parsed.datasets[0]?.pricing).toEqual({
      local: { usd: '$0.02', atomic: '20000' },
      global: {
        upto: { usd: '$0.10', atomic: '100000' },
        base: { usd: '$0.02', atomic: '20000' },
        perMapAnswer: { usd: '$0.01', atomic: '10000' },
      },
    });
  });
});
