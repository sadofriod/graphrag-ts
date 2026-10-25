import { describe, expect, test } from 'bun:test';
import { datasetRegistrySchema, isJudgmentDataset, parseDatasetRegistry, parseUsdToAtomic, toPublicDataset } from './datasets.ts';

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

  test('rejects malformed USD values in registry prices and unknown nested keys', () => {
    const invalidUsd = { datasets: [{ ...example.datasets[0]!, pricing: {
      ...example.datasets[0]!.pricing, local: '$1e-3',
    } }] };
    expect(() => datasetRegistrySchema.parse(invalidUsd)).toThrow('Prices must be non-negative USD amounts');
    expect(() => datasetRegistrySchema.parse({ datasets: [{ ...example.datasets[0]!, pricing: {
      ...example.datasets[0]!.pricing, global: { ...example.datasets[0]!.pricing.global, extra: true },
    } }] })).toThrow();
  });

  test('parses the valid spec example and retains display and atomic prices', () => {
    const parsed = parseDatasetRegistry(example);
    expect(parsed.datasets[0]?.pricing).toEqual({
      local: { usd: '$0.02', atomic: '20000' },
      global: {
        scheme: 'upto',
        upto: { usd: '$0.10', atomic: '100000' },
        base: { usd: '$0.02', atomic: '20000' },
        perMapAnswer: { usd: '$0.01', atomic: '10000' },
      },
    });
  });

  test('parses exact global scheme and defaults omitted scheme to upto', () => {
    const exact = parseDatasetRegistry({ datasets: [{
      ...example.datasets[0]!, pricing: { ...example.datasets[0]!.pricing, global: {
        ...example.datasets[0]!.pricing.global, scheme: 'exact',
      } },
    }] });
    const exactDataset = exact.datasets[0];
    const defaultDataset = parseDatasetRegistry(example).datasets[0];
    expect(exactDataset && !isJudgmentDataset(exactDataset) ? exactDataset.pricing.global.scheme : undefined).toBe('exact');
    expect(defaultDataset && !isJudgmentDataset(defaultDataset) ? defaultDataset.pricing.global.scheme : undefined).toBe('upto');
  });

  test('maps internal dataset fields and camel-case pricing into public wire names', () => {
    const parsed = parseDatasetRegistry(example).datasets[0]!;
    if (isJudgmentDataset(parsed)) throw new Error('Expected a graph dataset.');
    expect(toPublicDataset(parsed)).toEqual({
      id: 'web3-security', workspace_id: 'web3-security', title: 'Synthetic smart-contract security relations',
      description: 'Graph over a synthetic audit corpus.', synthetic: true,
      license: { spdx: 'MIT', url: 'https://example.com/license' }, tags: ['graphrag', 'security'],
      pricing: {
        local: { usd: '$0.02', atomic: '20000' },
        global: {
          scheme: 'upto', upto: { usd: '$0.10', atomic: '100000' }, base: { usd: '$0.02', atomic: '20000' },
          per_map_answer: { usd: '$0.01', atomic: '10000' },
        },
      },
    });
  });

  test('parses judgment products, validates prices and tool, and mixes products', () => {
    const judgment = { id: 'retraction-propagation', product: 'judgment', tool: 'retraction_propagation',
      title: 'Retraction propagation', description: 'Judgment.', synthetic: false,
      license: { spdx: 'CC0-1.0', url: 'https://example.com/license' }, tags: ['integrity'], pricing: { per_call: '$0.02' } };
    const parsed = parseDatasetRegistry({ datasets: [...example.datasets, judgment] });
    const product = parsed.datasets[1]!;
    expect(isJudgmentDataset(product)).toBe(true);
    if (!isJudgmentDataset(product)) throw new Error('Expected a judgment dataset.');
    expect(product.pricing.per_call).toEqual({ usd: '$0.02', atomic: '20000' });
    expect(toPublicDataset(product)).toMatchObject({ tool: 'retraction_propagation', pricing: { per_call: { atomic: '20000' } } });
    expect(() => datasetRegistrySchema.parse({ datasets: [{ ...judgment, tool: 'unknown' }] })).toThrow();
    expect(() => datasetRegistrySchema.parse({ datasets: [{ ...judgment, pricing: { per_call: '$1e-3' } }] })).toThrow('Prices must be non-negative USD amounts');
  });
});
