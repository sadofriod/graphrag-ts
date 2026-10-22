import { z } from 'zod';

const atomicAmountSchema = z.string().regex(/^[0-9]+$/);
const recordSchema = z.record(z.string(), z.unknown());

export const paymentRequirementsSchema = z.object({
  scheme: z.string().min(1),
  network: z.string().min(1),
  amount: atomicAmountSchema,
  asset: z.string().min(1),
  payTo: z.string().min(1),
  maxTimeoutSeconds: z.number().int().nonnegative(),
  extra: recordSchema.optional(),
}).passthrough();

export const bazaarExtensionSchema = z.object({
  info: z.unknown(),
  schema: z.unknown(),
}).passthrough();

export const paymentRequiredSchema = z.object({
  x402Version: z.literal(2),
  error: z.string().optional(),
  resource: z.object({ url: z.string(), description: z.string().optional(), mimeType: z.string().optional() }).passthrough().optional(),
  accepts: z.array(paymentRequirementsSchema).min(1),
  extensions: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

const authorizationSchema = z.object({ value: atomicAmountSchema.optional() }).passthrough();
const paymentSchemePayloadSchema = z.object({
  amount: atomicAmountSchema.optional(),
  value: atomicAmountSchema.optional(),
  authorization: authorizationSchema.optional(),
}).passthrough();

export const paymentPayloadSchema = z.object({
  x402Version: z.literal(2),
  resource: z.object({ url: z.string(), description: z.string().optional(), mimeType: z.string().optional() }).passthrough().optional(),
  accepted: paymentRequirementsSchema,
  payload: paymentSchemePayloadSchema,
  extensions: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export const verifyResponseSchema = z.object({
  isValid: z.boolean(),
  invalidReason: z.string().optional(),
  payer: z.string().optional(),
}).passthrough();

export const settleResponseSchema = z.object({
  success: z.boolean(),
  transaction: z.string(),
  network: z.string(),
  payer: z.string().optional(),
  amount: atomicAmountSchema.optional(),
  errorReason: z.string().optional(),
}).passthrough();

export type PaymentRequirements = z.infer<typeof paymentRequirementsSchema>;
export type PaymentRequired = z.infer<typeof paymentRequiredSchema>;
export type PaymentPayload = z.infer<typeof paymentPayloadSchema>;
export type VerifyResponse = z.infer<typeof verifyResponseSchema>;
export type SettleResponse = z.infer<typeof settleResponseSchema>;
export type BazaarExtension = z.infer<typeof bazaarExtensionSchema>;
export type VerifyRequest = { readonly paymentPayload: PaymentPayload; readonly paymentRequirements: PaymentRequirements };
export type SettleRequest = VerifyRequest;

export class X402FormatError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'X402FormatError';
    this.code = code;
  }
}

const MAX_HEADER_BYTES = 16 * 1024;

export const encodePaymentHeader = (value: unknown): string => Buffer.from(JSON.stringify(value), 'utf8').toString('base64');

export const decodePaymentHeader = (header: string): unknown => {
  if (typeof header !== 'string' || header.length > Math.ceil(MAX_HEADER_BYTES / 3) * 4 + 4) {
    throw new X402FormatError('PAYMENT_HEADER_TOO_LARGE', 'Payment header exceeds the 16 KiB limit.');
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(header)) {
    throw new X402FormatError('PAYMENT_HEADER_INVALID_BASE64', 'Payment header is not valid base64.');
  }
  const bytes = Buffer.from(header, 'base64');
  if (bytes.length > MAX_HEADER_BYTES || bytes.toString('base64') !== header) {
    throw new X402FormatError(bytes.length > MAX_HEADER_BYTES ? 'PAYMENT_HEADER_TOO_LARGE' : 'PAYMENT_HEADER_INVALID_BASE64',
      bytes.length > MAX_HEADER_BYTES ? 'Payment header exceeds the 16 KiB limit.' : 'Payment header is not valid base64.');
  }
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    throw new X402FormatError('PAYMENT_HEADER_INVALID_JSON', 'Payment header does not contain valid JSON.');
  }
};
