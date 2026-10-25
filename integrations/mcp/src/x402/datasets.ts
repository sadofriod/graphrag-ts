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

const graphSchema = z.object({
  product: z.literal('graph'), id: datasetIdSchema, workspace_id: workspaceIdSchema.removeDefault(), title: z.string().min(1),
  description: z.string(), synthetic: z.boolean(), license: z.object({ spdx: z.string().min(1), url: z.string().url() }).strict(),
  pricing: z.object({
    local: usdSchema,
    global: z.object({ scheme: z.enum(['upto', 'exact']).default('upto'), upto: usdSchema, base: usdSchema, per_map_answer: usdSchema }).strict(),
  }).strict(), tags: z.array(z.string()).max(5),
}).strict();

const judgmentSchema = z.object({
  product: z.literal('judgment'), id: datasetIdSchema, tool: z.enum(['retraction_propagation', 'evidence_audit']),
  title: z.string().min(1), description: z.string(), synthetic: z.boolean(),
  license: z.object({ spdx: z.string().min(1), url: z.string().url() }).strict(),
  tags: z.array(z.string()).max(5), pricing: z.object({ per_call: usdSchema }).strict(),
}).strict();

const defaultGraphProduct = z.preprocess((value) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  return { ...value, product: 'product' in value ? value.product : 'graph' };
}, z.discriminatedUnion('product', [graphSchema, judgmentSchema]));

export type GraphDataset = {
  readonly product: 'graph'; readonly id: string; readonly workspaceId: string; readonly title: string; readonly description: string;
  readonly synthetic: boolean; readonly license: { readonly spdx: string; readonly url: string }; readonly tags: readonly string[];
  readonly pricing: {
    readonly local: { readonly usd: string; readonly atomic: string };
    readonly global: { readonly scheme: 'upto' | 'exact'; readonly upto: { readonly usd: string; readonly atomic: string }; readonly base: { readonly usd: string; readonly atomic: string }; readonly perMapAnswer: { readonly usd: string; readonly atomic: string } };
  };
};

export type JudgmentDataset = {
  readonly product: 'judgment'; readonly id: string; readonly tool: 'retraction_propagation' | 'evidence_audit';
  readonly title: string; readonly description: string; readonly synthetic: boolean;
  readonly license: { readonly spdx: string; readonly url: string }; readonly tags: readonly string[];
  readonly pricing: { readonly per_call: { readonly usd: string; readonly atomic: string } };
};

export type Dataset = GraphDataset | JudgmentDataset;
export type DatasetRegistry = { readonly datasets: readonly Dataset[] };
export const isJudgmentDataset = (dataset: Dataset): dataset is JudgmentDataset => dataset.product === 'judgment';

export const toPublicDataset = (dataset: Dataset) => isJudgmentDataset(dataset) ? ({
  id: dataset.id, product: dataset.product, tool: dataset.tool, title: dataset.title, description: dataset.description,
  synthetic: dataset.synthetic, license: dataset.license, tags: dataset.tags,
  pricing: { per_call: dataset.pricing.per_call },
}) : ({
  id: dataset.id, workspace_id: dataset.workspaceId, title: dataset.title,
  description: dataset.description, synthetic: dataset.synthetic, license: dataset.license, tags: dataset.tags,
  pricing: {
    local: dataset.pricing.local,
    global: { scheme: dataset.pricing.global.scheme, upto: dataset.pricing.global.upto, base: dataset.pricing.global.base, per_map_answer: dataset.pricing.global.perMapAnswer },
  },
});

export const datasetRegistrySchema = z.object({ datasets: z.array(defaultGraphProduct).min(1) }).strict().superRefine((registry, context) => {
  const ids = new Set<string>();
  const workspaces = new Set<string>();
  for (const [index, dataset] of registry.datasets.entries()) {
    if (ids.has(dataset.id)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['datasets', index, 'id'], message: 'Dataset ids must be unique.' });
    ids.add(dataset.id);
    if (dataset.product === 'graph') {
      if (workspaces.has(dataset.workspace_id)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['datasets', index, 'workspace_id'], message: 'Workspace ids must be unique.' });
      workspaces.add(dataset.workspace_id);
      const prices = [dataset.pricing.local, dataset.pricing.global.upto, dataset.pricing.global.base, dataset.pricing.global.per_map_answer];
      for (const price of prices) validatePrice(price, context, index);
      validateUpto(dataset.pricing.global.upto, dataset.pricing.global.base, context, index);
    } else {
      validatePrice(dataset.pricing.per_call, context, index);
    }
  }
});

const validatePrice = (price: string, context: z.RefinementCtx, index: number): void => {
  try { parseUsdToAtomic(price); } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['datasets', index, 'pricing'], message: 'Prices must be non-negative USD amounts with at most 6 decimals.' });
  }
};

const validateUpto = (upto: string, base: string, context: z.RefinementCtx, index: number): void => {
  try {
    if (BigInt(parseUsdToAtomic(upto)) < BigInt(parseUsdToAtomic(base))) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['datasets', index, 'pricing', 'global'], message: 'global.upto must be at least global.base.' });
    }
  } catch { /* Individual price issues provide the useful validation message. */ }
};

const parsedDataset = (dataset: z.infer<typeof defaultGraphProduct>): Dataset => {
  const common = { id: dataset.id, product: dataset.product, title: dataset.title, description: dataset.description,
    synthetic: dataset.synthetic, license: dataset.license, tags: dataset.tags };
  if (dataset.product === 'judgment') return { ...common, product: 'judgment', tool: dataset.tool,
    pricing: { per_call: { usd: dataset.pricing.per_call, atomic: parseUsdToAtomic(dataset.pricing.per_call) } } };
  return { ...common, product: 'graph', workspaceId: dataset.workspace_id,
    pricing: {
      local: { usd: dataset.pricing.local, atomic: parseUsdToAtomic(dataset.pricing.local) },
      global: { scheme: dataset.pricing.global.scheme,
        upto: { usd: dataset.pricing.global.upto, atomic: parseUsdToAtomic(dataset.pricing.global.upto) },
        base: { usd: dataset.pricing.global.base, atomic: parseUsdToAtomic(dataset.pricing.global.base) },
        perMapAnswer: { usd: dataset.pricing.global.per_map_answer, atomic: parseUsdToAtomic(dataset.pricing.global.per_map_answer) } },
    } };
};

export const parseDatasetRegistry = (value: unknown): DatasetRegistry => {
  const parsed = datasetRegistrySchema.parse(value);
  return { datasets: parsed.datasets.map(parsedDataset) };
};

export const loadDatasetRegistry = async (path: string): Promise<DatasetRegistry> => {
  let content: string;
  try { content = await readFile(path, 'utf8'); } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') throw new Error(`Dataset registry file not found: ${path}`);
    throw error;
  }
  return parseDatasetRegistry(JSON.parse(content) as unknown);
};

export const findDataset = (registry: DatasetRegistry, datasetId: string): Dataset | undefined =>
  registry.datasets.find((dataset) => dataset.id === datasetId);
