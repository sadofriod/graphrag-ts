import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { workspaceIdSchema } from '../workspace.ts';

const datasetIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);
const usdSchema = z.string().min(1);

export const parseUsdToAtomic = (value: string): string => {
  const normalized = value.trim().replace(/^\$/, '');
  if (!normalized || normalized.startsWith('-') || !/^\d+(?:\.\d{1,6})?$/.test(normalized)) {
    throw new Error('USD amount must be a non-negative decimal with at most 6 fractional digits.');
  }
  const [whole = '', fraction = ''] = normalized.split('.');
  return `${whole}${fraction.padEnd(6, '0')}`.replace(/^0+(?=\d)/, '');
};

const priceSchema = z.object({
  local: usdSchema,
  global: z.object({ upto: usdSchema, base: usdSchema, per_map_answer: usdSchema }).strict(),
});

const rawDatasetSchema = z.object({
  id: datasetIdSchema,
  workspace_id: workspaceIdSchema.removeDefault(),
  title: z.string().min(1),
  description: z.string(),
  synthetic: z.boolean(),
  license: z.object({ spdx: z.string().min(1), url: z.string().url() }).strict(),
  pricing: priceSchema.strict(),
  tags: z.array(z.string()).max(5),
}).strict();

export type Dataset = {
  readonly id: string;
  readonly workspaceId: string;
  readonly title: string;
  readonly description: string;
  readonly synthetic: boolean;
  readonly license: { readonly spdx: string; readonly url: string };
  readonly pricing: {
    readonly local: { readonly usd: string; readonly atomic: string };
    readonly global: {
      readonly upto: { readonly usd: string; readonly atomic: string };
      readonly base: { readonly usd: string; readonly atomic: string };
      readonly perMapAnswer: { readonly usd: string; readonly atomic: string };
    };
  };
  readonly tags: readonly string[];
};

export type DatasetRegistry = { readonly datasets: readonly Dataset[] };

export const datasetRegistrySchema = z.object({ datasets: z.array(rawDatasetSchema).min(1) }).strict().superRefine((registry, context) => {
  const ids = new Set<string>();
  const workspaces = new Set<string>();
  for (const [index, dataset] of registry.datasets.entries()) {
    if (ids.has(dataset.id)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['datasets', index, 'id'], message: 'Dataset ids must be unique.' });
    if (workspaces.has(dataset.workspace_id)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['datasets', index, 'workspace_id'], message: 'Workspace ids must be unique.' });
    ids.add(dataset.id);
    workspaces.add(dataset.workspace_id);
    for (const price of [dataset.pricing.local, dataset.pricing.global.upto, dataset.pricing.global.base, dataset.pricing.global.per_map_answer]) {
      try { parseUsdToAtomic(price); } catch {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['datasets', index, 'pricing'], message: 'Prices must be non-negative USD amounts with at most 6 decimals.' });
      }
    }
    try {
      if (BigInt(parseUsdToAtomic(dataset.pricing.global.upto)) < BigInt(parseUsdToAtomic(dataset.pricing.global.base))) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['datasets', index, 'pricing', 'global'], message: 'global.upto must be at least global.base.' });
      }
    } catch { /* The individual price issue above is sufficient. */ }
  }
});

export const parseDatasetRegistry = (value: unknown): DatasetRegistry => {
  const parsed = datasetRegistrySchema.parse(value);
  return {
    datasets: parsed.datasets.map((dataset) => ({
      id: dataset.id,
      workspaceId: dataset.workspace_id,
      title: dataset.title,
      description: dataset.description,
      synthetic: dataset.synthetic,
      license: dataset.license,
      pricing: {
        local: { usd: dataset.pricing.local, atomic: parseUsdToAtomic(dataset.pricing.local) },
        global: {
          upto: { usd: dataset.pricing.global.upto, atomic: parseUsdToAtomic(dataset.pricing.global.upto) },
          base: { usd: dataset.pricing.global.base, atomic: parseUsdToAtomic(dataset.pricing.global.base) },
          perMapAnswer: { usd: dataset.pricing.global.per_map_answer, atomic: parseUsdToAtomic(dataset.pricing.global.per_map_answer) },
        },
      },
      tags: dataset.tags,
    })),
  };
};

export const loadDatasetRegistry = async (path: string): Promise<DatasetRegistry> => {
  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      throw new Error(`Dataset registry file not found: ${path}`);
    }
    throw error;
  }
  return parseDatasetRegistry(JSON.parse(content) as unknown);
};

export const findDataset = (registry: DatasetRegistry, datasetId: string): Dataset | undefined =>
  registry.datasets.find((dataset) => dataset.id === datasetId);
