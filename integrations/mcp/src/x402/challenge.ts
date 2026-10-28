import type { Dataset } from './datasets.ts';
import { encodePaymentHeader, type PaymentRequirements } from './types.ts';
import type { X402Settings } from './settings.ts';
import { jsonResponse, publicUrl } from './http.ts';
import { bazaarDeclaration } from './bazaar.ts';
import { authorizationFor } from './pricing.ts';

export const requirementsFor = (dataset: Dataset, mode: 'local' | 'global', settings: X402Settings): PaymentRequirements => mode === 'local'
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

const asciiMetadata = (value: string, maximumLength: number): boolean =>
  value.length <= maximumLength && /^[\x20-\x7E]+$/.test(value);

const resourceTags = (dataset: Dataset): string[] => dataset.tags
  .filter((tag) => asciiMetadata(tag, 32))
  .slice(0, 5);

const oneLineDescription = (description: string): string => description.replace(/\s+/g, ' ').trim();

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
      description: oneLineDescription(dataset.description),
      mimeType: 'application/json',
      serviceName: 'graphrag-ts',
      tags: resourceTags(dataset),
    },
    accepts: [requirements],
    extensions: { bazaar: bazaarDeclaration(dataset, mode) },
  };
  return jsonResponse(402, error ? { error } : {}, { 'payment-required': encodePaymentHeader(required) });
};

export const matchesRequirements = (accepted: PaymentRequirements, expected: PaymentRequirements): boolean =>
  accepted.scheme === expected.scheme && accepted.network === expected.network && accepted.asset === expected.asset
  && accepted.payTo === expected.payTo && accepted.amount === expected.amount;
