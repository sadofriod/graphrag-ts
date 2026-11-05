import type { GraphDataset } from './datasets.ts';
import { encodePaymentHeader, type PaymentRequirements } from './types.ts';
import type { X402Settings } from './settings.ts';
import { jsonResponse, publicUrl } from './http.ts';
import { bazaarDeclaration } from './bazaar.ts';
import { judgmentBazaarDeclaration, referenceBatchBazaarDeclaration } from './bazaar.ts';
export { requirementsFor } from './pricing.ts';

const asciiMetadata = (value: string, maximumLength: number): boolean =>
  value.length <= maximumLength && /^[\x20-\x7E]+$/.test(value);

const resourceTags = (dataset: GraphDataset): string[] => dataset.tags
  .filter((tag) => asciiMetadata(tag, 32))
  .slice(0, 5);

const oneLineDescription = (description: string): string => description.replace(/\s+/g, ' ').trim();

export const buildChallenge = (
  request: Request,
  dataset: GraphDataset,
  mode: 'local' | 'global',
  requirements: readonly PaymentRequirements[],
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
    accepts: requirements,
    extensions: { bazaar: bazaarDeclaration(dataset, mode) },
  };
  return jsonResponse(402, error ? { error } : {}, { 'payment-required': encodePaymentHeader(required) });
};

export const buildJudgmentChallenge = (
  request: Request,
  dataset: import('./datasets.ts').JudgmentDataset,
  requirements: readonly PaymentRequirements[],
  settings: X402Settings,
  error?: string,
  fixedBatchRoute = false,
): Response => {
  const required = {
    x402Version: 2,
    ...(error ? { error } : {}),
    resource: { url: publicUrl(request, settings.publicBaseUrl), description: oneLineDescription(dataset.description),
      mimeType: 'application/json', serviceName: 'graphrag-ts', tags: dataset.tags.filter((tag) => asciiMetadata(tag, 32)).slice(0, 5) },
    accepts: requirements, extensions: { bazaar: dataset.tool === 'reference_batch'
      ? referenceBatchBazaarDeclaration(dataset, !fixedBatchRoute) : judgmentBazaarDeclaration(dataset) },
  };
  return jsonResponse(402, error ? { error } : {}, { 'payment-required': encodePaymentHeader(required) });
};


export const matchesRequirements = (accepted: PaymentRequirements, expected: PaymentRequirements): boolean =>
  accepted.scheme === expected.scheme && accepted.network === expected.network && accepted.asset === expected.asset
  && accepted.payTo === expected.payTo && accepted.amount === expected.amount;

export const matchRequirements = (
  accepted: PaymentRequirements,
  expected: readonly PaymentRequirements[],
): PaymentRequirements | undefined => expected.find((requirements) => matchesRequirements(accepted, requirements));
