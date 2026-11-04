import type { GraphDataset, JudgmentDataset } from './datasets.ts';
import type { PaymentRequirements } from './types.ts';
import type { X402Settings } from './settings.ts';

export const authorizationFor = (dataset: GraphDataset, mode: 'local' | 'global'): string => mode === 'local'
  ? dataset.pricing.local.atomic
  : dataset.pricing.global.upto.atomic;

export const requirementsFor = (dataset: GraphDataset, mode: 'local' | 'global', settings: X402Settings): PaymentRequirements => mode === 'local'
  ? {
      scheme: 'exact', network: settings.network, amount: authorizationFor(dataset, mode), asset: settings.asset,
      payTo: settings.payTo, maxTimeoutSeconds: settings.maxTimeoutSeconds,
      extra: { name: settings.assetName, version: settings.assetVersion },
    }
  : {
      scheme: dataset.pricing.global.scheme, network: settings.network, amount: authorizationFor(dataset, mode), asset: settings.asset,
      payTo: settings.payTo, maxTimeoutSeconds: settings.maxTimeoutSeconds,
      extra: dataset.pricing.global.scheme === 'upto'
        ? {
            name: settings.assetName,
            version: settings.assetVersion,
            paymentFlow: 'authorization',
            ...(settings.uptoFacilitatorAddress ? { facilitatorAddress: settings.uptoFacilitatorAddress } : {}),
          }
        : { name: settings.assetName, version: settings.assetVersion },
    };

export const requirementsForNetworks = (
  dataset: GraphDataset,
  mode: 'local' | 'global',
  settings: X402Settings,
): PaymentRequirements[] => {
  if (mode === 'global' && dataset.pricing.global.scheme !== 'exact') {
    return [requirementsFor(dataset, mode, settings)];
  }
  return settings.judgeNetworks.map((entry) => ({
    scheme: 'exact', network: entry.network, amount: authorizationFor(dataset, mode),
    asset: entry.asset, payTo: settings.payTo, maxTimeoutSeconds: settings.maxTimeoutSeconds,
    extra: { name: entry.assetName, version: entry.assetVersion },
  }));
};

export const settleAmountFor = (dataset: GraphDataset, mode: 'local' | 'global', mapAnswers: number): string => {
  if (mode === 'local') return dataset.pricing.local.atomic;
  if (dataset.pricing.global.scheme === 'exact') return dataset.pricing.global.upto.atomic;
  const authorization = BigInt(dataset.pricing.global.upto.atomic);
  const computed = BigInt(dataset.pricing.global.base.atomic)
    + BigInt(dataset.pricing.global.perMapAnswer.atomic) * BigInt(mapAnswers);
  return (computed < authorization ? computed : authorization).toString();
};

export const judgmentRequirements = (dataset: JudgmentDataset, settings: X402Settings): PaymentRequirements[] =>
  settings.judgeNetworks.map((entry) => ({
    scheme: 'exact', network: entry.network, amount: dataset.pricing.per_call.atomic,
    asset: entry.asset, payTo: settings.payTo, maxTimeoutSeconds: settings.maxTimeoutSeconds,
    extra: { name: entry.assetName, version: entry.assetVersion },
  }));
