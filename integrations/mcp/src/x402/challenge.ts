import type { Dataset } from './datasets.ts';
import { encodePaymentHeader, type PaymentRequirements } from './types.ts';
import type { X402Settings } from './settings.ts';
import { jsonResponse, publicUrl } from './http.ts';

export const requirementsFor = (dataset: Dataset, mode: 'local' | 'global', settings: X402Settings): PaymentRequirements => mode === 'local'
  ? {
      scheme: 'exact', network: settings.network, amount: dataset.pricing.local.atomic, asset: settings.asset,
      payTo: settings.payTo, maxTimeoutSeconds: settings.maxTimeoutSeconds,
      extra: { name: settings.assetName, version: settings.assetVersion },
    }
  : {
      scheme: 'upto', network: settings.network, amount: dataset.pricing.global.upto.atomic, asset: settings.asset,
      payTo: settings.payTo, maxTimeoutSeconds: settings.maxTimeoutSeconds,
      extra: { name: settings.assetName, version: settings.assetVersion, paymentFlow: 'authorization' },
    };

const bazaar = (dataset: Dataset, mode: 'local' | 'global') => ({
  info: {
    service: 'graphrag-ts', dataset_id: dataset.id, title: dataset.title, description: dataset.description,
    mode, tags: dataset.tags,
  },
  schema: {
    type: 'object', required: ['dataset_id', 'query'],
    properties: {
      dataset_id: { type: 'string', const: dataset.id }, query: { type: 'string', minLength: 1, maxLength: 4000 },
      mode: { type: 'string', enum: ['local', 'global'] }, max_results: { type: 'integer', minimum: 1, maximum: 20 },
    },
  },
});

export const buildChallenge = (
  request: Request,
  dataset: Dataset,
  mode: 'local' | 'global',
  requirements: PaymentRequirements,
  settings: X402Settings,
  error?: string,
): Response => {
  const required = {
    x402Version: 2,
    ...(error ? { error } : {}),
    resource: {
      url: publicUrl(request, settings.publicBaseUrl),
      description: dataset.description,
      mimeType: 'application/json',
      serviceName: 'graphrag-ts',
      tags: dataset.tags,
    },
    accepts: [requirements],
    extensions: { bazaar: bazaar(dataset, mode) },
  };
  return jsonResponse(402, error ? { error } : {}, { 'payment-required': encodePaymentHeader(required) });
};

export const matchesRequirements = (accepted: PaymentRequirements, expected: PaymentRequirements): boolean =>
  accepted.scheme === expected.scheme && accepted.network === expected.network && accepted.asset === expected.asset
  && accepted.payTo === expected.payTo && accepted.amount === expected.amount;
