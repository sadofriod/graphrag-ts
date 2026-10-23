import { createPrivateKey, createSign, randomBytes, sign as cryptoSign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import {
  settleResponseSchema,
  verifyResponseSchema,
  type SettleRequest,
  type SettleResponse,
  type VerifyRequest,
  type VerifyResponse,
} from './types.ts';
import { X402FacilitatorError, type FacilitatorClient } from './facilitator.ts';

const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const DEFAULT_BASE_URL = 'https://api.cdp.coinbase.com/platform/v2/x402';

type JwtHeader = { readonly alg: 'EdDSA' | 'ES256'; readonly kid: string; readonly typ: 'JWT'; readonly nonce: string };
type JwtClaims = {
  readonly sub: string;
  readonly iss: 'cdp';
  readonly aud: readonly ['cdp_service'];
  readonly nbf: number;
  readonly exp: number;
  readonly uris: readonly string[];
};

const base64url = (value: Buffer | string): string => Buffer.from(value).toString('base64url');

const createEd25519Key = (secret: Buffer): KeyObject => {
  const seed = secret.subarray(0, 32);
  return createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' });
};

const createEs256Key = (secret: Buffer): KeyObject => {
  const text = secret.toString('utf8');
  if (text.includes('-----BEGIN')) return createPrivateKey(text);
  return createPrivateKey({ key: secret, format: 'der', type: 'pkcs8' });
};

const readDerLength = (signature: Buffer, offset: number): { readonly length: number; readonly next: number } => {
  const first = signature[offset];
  if (first === undefined) throw new Error('Invalid ES256 signature.');
  if ((first & 0x80) === 0) return { length: first, next: offset + 1 };
  const byteCount = first & 0x7f;
  let length = 0;
  for (let index = 0; index < byteCount; index += 1) {
    const byte = signature[offset + 1 + index];
    if (byte === undefined) throw new Error('Invalid ES256 signature.');
    length = (length << 8) | byte;
  }
  return { length, next: offset + 1 + byteCount };
};

const readDerInteger = (signature: Buffer, offset: number): { readonly value: Buffer; readonly next: number } => {
  if (signature[offset] !== 0x02) throw new Error('Invalid ES256 signature.');
  const length = readDerLength(signature, offset + 1);
  const value = signature.subarray(length.next, length.next + length.length);
  return { value, next: length.next + length.length };
};

const derEcdsaToRaw = (signature: Buffer): Buffer => {
  if (signature[0] !== 0x30) throw new Error('Invalid ES256 signature.');
  const sequence = readDerLength(signature, 1);
  const r = readDerInteger(signature, sequence.next);
  const s = readDerInteger(signature, r.next);
  return Buffer.concat([to32Bytes(r.value), to32Bytes(s.value)]);
};

const to32Bytes = (integer: Buffer): Buffer => {
  const unsigned = integer[0] === 0 ? integer.subarray(1) : integer;
  if (unsigned.length > 32) throw new Error('Invalid ES256 signature.');
  return Buffer.concat([Buffer.alloc(32 - unsigned.length), unsigned]);
};

const signEs256 = (input: string, key: KeyObject): Buffer => {
  const signer = createSign('SHA256');
  signer.update(input);
  signer.end();
  return derEcdsaToRaw(signer.sign(key));
};

const encodeJwtPart = (value: JwtHeader | JwtClaims): string => base64url(JSON.stringify(value));

export const signCdpJwt = async ({
  apiKeyId,
  apiKeySecret,
  method,
  host,
  path,
  now = Math.floor(Date.now() / 1000),
  expiresInSeconds = 120,
}: {
  readonly apiKeyId: string;
  readonly apiKeySecret: string;
  readonly method: string;
  readonly host: string;
  readonly path: string;
  readonly now?: number;
  readonly expiresInSeconds?: number;
}): Promise<string> => {
  const decoded = Buffer.from(apiKeySecret, 'base64');
  const isEd25519 = decoded.length === 32 || decoded.length === 64;
  const key = isEd25519 ? createEd25519Key(decoded) : createEs256Key(decoded);
  const header: JwtHeader = {
    alg: isEd25519 ? 'EdDSA' : 'ES256',
    kid: apiKeyId,
    typ: 'JWT',
    nonce: randomBytes(8).toString('hex'),
  };
  const claims: JwtClaims = {
    sub: apiKeyId,
    iss: 'cdp',
    aud: ['cdp_service'],
    nbf: now,
    exp: now + expiresInSeconds,
    uris: [`${method.toUpperCase()} ${host}${path}`],
  };
  const input = `${encodeJwtPart(header)}.${encodeJwtPart(claims)}`;
  const signature = isEd25519 ? cryptoSign(null, Buffer.from(input), key) : signEs256(input, key);
  return `${input}.${base64url(signature)}`;
};

const requestUrl = (baseUrl: string, endpoint: 'verify' | 'settle'): URL => {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/$/, '')}/${endpoint}`;
  return url;
};

const isPaymentRejection = (endpoint: 'verify' | 'settle', value: unknown): boolean => {
  if (typeof value !== 'object' || value === null) return false;
  return endpoint === 'verify'
    ? 'isValid' in value && value.isValid === false
    : 'success' in value && value.success === false;
};

const httpError = (status: number): X402FacilitatorError =>
  new X402FacilitatorError('FACILITATOR_HTTP', `Facilitator returned HTTP ${status}.`, status);

const readResponseBody = async (response: Response): Promise<unknown> => {
  try {
    return await response.json() as unknown;
  } catch {
    if (!response.ok) throw httpError(response.status);
    throw new X402FacilitatorError('FACILITATOR_INVALID_RESPONSE', 'Facilitator returned malformed JSON.');
  }
};

const normalizeSettleRejection = (body: unknown, endpoint: 'verify' | 'settle', response: Response): unknown => {
  if (endpoint !== 'settle' || response.ok || !isPaymentRejection(endpoint, body)
    || typeof body !== 'object' || body === null || 'transaction' in body) return body;
  return { ...body, transaction: '' };
};

const parseResponseBody = <T>(body: unknown, response: Response, endpoint: 'verify' | 'settle', schema: { parse(value: unknown): T }): T => {
  try {
    return schema.parse(body);
  } catch {
    if (!response.ok) throw httpError(response.status);
    throw new X402FacilitatorError('FACILITATOR_INVALID_RESPONSE', `Facilitator returned an invalid ${endpoint} response.`);
  }
};

const parseResponse = async <T>(response: Response, endpoint: 'verify' | 'settle', schema: { parse(value: unknown): T }): Promise<T> => {
  if (!response.ok && ![400, 402, 403].includes(response.status)) throw httpError(response.status);
  const body = normalizeSettleRejection(await readResponseBody(response), endpoint, response);
  const parsed = parseResponseBody(body, response, endpoint, schema);
  if (!response.ok && !isPaymentRejection(endpoint, parsed)) throw httpError(response.status);
  return parsed;
};

const post = async <T>(
  endpoint: 'verify' | 'settle',
  request: VerifyRequest,
  schema: { parse(value: unknown): T },
  options: { readonly apiKeyId: string; readonly apiKeySecret: string; readonly baseUrl: string; readonly fetchImpl: (input: string, init: RequestInit) => Promise<Response> },
): Promise<T> => {
  try {
    const url = requestUrl(options.baseUrl, endpoint);
    const jwt = await signCdpJwt({
      apiKeyId: options.apiKeyId,
      apiKeySecret: options.apiKeySecret,
      method: 'POST',
      host: url.host,
      path: url.pathname,
    });
    const response = await options.fetchImpl(url.toString(), {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({ x402Version: 2, paymentPayload: request.paymentPayload, paymentRequirements: request.paymentRequirements }),
      signal: AbortSignal.timeout(10_000),
    });
    return await parseResponse(response, endpoint, schema);
  } catch (error) {
    if (error instanceof X402FacilitatorError) throw error;
    throw new X402FacilitatorError('FACILITATOR_REQUEST_FAILED', `Facilitator ${endpoint} request failed.`);
  }
};

export const createCdpFacilitatorClient = ({
  apiKeyId,
  apiKeySecret,
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = fetch,
}: {
  readonly apiKeyId: string;
  readonly apiKeySecret: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: (input: string, init: RequestInit) => Promise<Response>;
}): FacilitatorClient => {
  const options = { apiKeyId, apiKeySecret, baseUrl, fetchImpl };
  return {
    verify: (request: VerifyRequest): Promise<VerifyResponse> => post('verify', request, verifyResponseSchema, options),
    settle: (request: SettleRequest): Promise<SettleResponse> => post('settle', request, settleResponseSchema, options),
  };
};
