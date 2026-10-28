import type { Dataset } from './datasets.ts';

export const authorizationFor = (dataset: Dataset, mode: 'local' | 'global'): string => mode === 'local'
  ? dataset.pricing.local.atomic
  : dataset.pricing.global.upto.atomic;

export const settleAmountFor = (dataset: Dataset, mode: 'local' | 'global', mapAnswers: number): string => {
  if (mode === 'local') return dataset.pricing.local.atomic;
  if (dataset.pricing.global.scheme === 'exact') return dataset.pricing.global.upto.atomic;
  const authorization = BigInt(dataset.pricing.global.upto.atomic);
  const computed = BigInt(dataset.pricing.global.base.atomic)
    + BigInt(dataset.pricing.global.perMapAnswer.atomic) * BigInt(mapAnswers);
  return (computed < authorization ? computed : authorization).toString();
};
