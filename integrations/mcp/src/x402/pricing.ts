import type { GraphDataset, JudgmentDataset } from './datasets.ts';

export const authorizationFor = (dataset: GraphDataset, mode: 'local' | 'global'): string => mode === 'local'
  ? dataset.pricing.local.atomic
  : dataset.pricing.global.upto.atomic;

export const settleAmountFor = (dataset: GraphDataset, mode: 'local' | 'global', mapAnswers: number): string => {
  if (mode === 'local') return dataset.pricing.local.atomic;
  if (dataset.pricing.global.scheme === 'exact') return dataset.pricing.global.upto.atomic;
  const authorization = BigInt(dataset.pricing.global.upto.atomic);
  const computed = BigInt(dataset.pricing.global.base.atomic)
    + BigInt(dataset.pricing.global.perMapAnswer.atomic) * BigInt(mapAnswers);
  return (computed < authorization ? computed : authorization).toString();
};

export const judgmentRequirements = (dataset: JudgmentDataset, settings: {
  readonly network: string; readonly asset: string; readonly payTo: string; readonly maxTimeoutSeconds: number;
  readonly assetName: string; readonly assetVersion: string;
}) => ({
  scheme: 'exact' as const, network: settings.network, amount: dataset.pricing.per_call.atomic,
  asset: settings.asset, payTo: settings.payTo, maxTimeoutSeconds: settings.maxTimeoutSeconds,
  extra: { name: settings.assetName, version: settings.assetVersion },
});
