import { createHash } from 'node:crypto';
import { z } from 'zod';
import { decodePaymentHeader, paymentPayloadSchema, type PaymentPayload, X402FormatError } from './types.ts';

export const bodySchema = z.object({
  dataset_id: z.string().min(1),
  query: z.string().min(1).max(4000),
  mode: z.enum(['local', 'global']).default('local'),
  max_results: z.number().int().min(1).max(20).default(5),
}).strict();

export type QueryInput = z.infer<typeof bodySchema>;

export const judgmentBodySchema = z.object({
  dataset_id: z.string().min(1), doi: z.string().min(1).max(300).optional(), paper_id: z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/).optional(),
}).strict().refine((input) => Number(input.doi !== undefined) + Number(input.paper_id !== undefined) === 1, {
  message: 'Provide exactly one of doi or paper_id.',
});
export type JudgmentInput = z.infer<typeof judgmentBodySchema>;

const readRequestText = async (request: Request): Promise<string> => {
  if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    throw new Error('Request body must be JSON.');
  }
  if (Number(request.headers.get('content-length') ?? 0) > 8192) throw new Error('Request body exceeds 8192 bytes.');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Invalid request body.');
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    totalBytes += next.value.byteLength;
    if (totalBytes > 8192) {
      await reader.cancel();
      throw new Error('Request body exceeds 8192 bytes.');
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
};

export const parseRequestBody = async (request: Request): Promise<{ input?: QueryInput; error?: string }> => {
  try {
    const text = await readRequestText(request);
    return { input: bodySchema.parse(JSON.parse(text) as unknown) };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request body.';
    return { error: ['Request body must be JSON.', 'Request body exceeds 8192 bytes.'].includes(message) ? message : 'Invalid request body.' };
  }
};

export const parseJudgmentRequestBody = async (request: Request): Promise<{ input?: JudgmentInput; error?: string }> => {
  try {
    const text = await readRequestText(request);
    return { input: judgmentBodySchema.parse(JSON.parse(text) as unknown) };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request body.';
    return { error: ['Request body must be JSON.', 'Request body exceeds 8192 bytes.'].includes(message) ? message : 'invalid_request_body' };
  }
};

export const parsePaymentPayload = (signature: string): { payload?: PaymentPayload; error?: string } => {
  try {
    const parsed = paymentPayloadSchema.safeParse(decodePaymentHeader(signature));
    if (!parsed.success) throw new X402FormatError('PAYMENT_PAYLOAD_INVALID', 'Payment payload is invalid.');
    const payload = parsed.data;
    nonceFromPayload(payload);
    return { payload };
  } catch (error) {
    return { error: error instanceof X402FormatError ? error.message : 'Payment payload is invalid.' };
  }
};

export const nonceFromPayload = (payload: PaymentPayload): string => {
  const nonce = payload.payload.authorization?.nonce ?? payload.payload.permit2Authorization?.nonce;
  if (typeof nonce !== 'string' || nonce.length < 1 || nonce.length > 256) {
    throw new X402FormatError('PAYMENT_PAYLOAD_INVALID', 'Payment payload authorization is invalid.');
  }
  if (/^0x[0-9a-f]+$/i.test(nonce)) return `0x${BigInt(nonce).toString(16)}`;
  if (/^[0-9]+$/.test(nonce)) return BigInt(nonce).toString(10);
  return nonce;
};

export const authorizationContractFromPayload = (payload: PaymentPayload): string =>
  payload.payload.permit2Authorization
    ? '0x000000000022d473030f116ddee9f6b43ac78ba3'
    : payload.accepted.asset.toLowerCase();

export const validIdempotencyKey = (key: string | null): boolean => key === null || /^[A-Za-z0-9._:-]{8,200}$/.test(key);

export const requestHash = (input: QueryInput): string => createHash('sha256')
  .update(JSON.stringify({ dataset_id: input.dataset_id, query: input.query, mode: input.mode, max_results: input.max_results }))
  .digest('hex');

export const judgmentRequestHash = (input: JudgmentInput): string => createHash('sha256')
  .update(JSON.stringify({ dataset_id: input.dataset_id, doi: input.doi ?? null, paper_id: input.paper_id ?? null }))
  .digest('hex');
