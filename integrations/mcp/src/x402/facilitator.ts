import {
  settleResponseSchema,
  verifyResponseSchema,
  type SettleRequest,
  type SettleResponse,
  type VerifyRequest,
  type VerifyResponse,
} from './types.ts';

export interface FacilitatorClient {
  verify(request: VerifyRequest): Promise<VerifyResponse>;
  settle(request: SettleRequest): Promise<SettleResponse>;
  request?(path: string): Promise<{ readonly status: number; readonly json: unknown }>;
}

export class X402FacilitatorError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = 'X402FacilitatorError';
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

const httpError = (status: number, bodyText?: string): X402FacilitatorError => {
  const detail = bodyText?.slice(0, 500);
  return new X402FacilitatorError(
    'FACILITATOR_HTTP',
    detail ? `Facilitator returned HTTP ${status}: ${detail}` : `Facilitator returned HTTP ${status}.`,
    status,
  );
};

const isPaymentRejection = (endpoint: 'verify' | 'settle', value: unknown): boolean => {
  if (typeof value !== 'object' || value === null) return false;
  return endpoint === 'verify'
    ? 'isValid' in value && value.isValid === false
    : 'success' in value && value.success === false;
};

const readFacilitatorBody = async (response: Response): Promise<{ readonly body: unknown; readonly text: string }> => {
  let text: string;
  try {
    text = await response.text();
  } catch {
    if (!response.ok) throw httpError(response.status);
    throw new X402FacilitatorError('FACILITATOR_INVALID_RESPONSE', 'Facilitator returned malformed JSON.');
  }
  try {
    return { body: JSON.parse(text) as unknown, text };
  } catch {
    if (!response.ok) throw httpError(response.status, text);
    throw new X402FacilitatorError('FACILITATOR_INVALID_RESPONSE', 'Facilitator returned malformed JSON.');
  }
};

const normalizedRejectionBody = (body: unknown, response: Response, endpoint: 'verify' | 'settle'): unknown => {
  if (response.ok || endpoint !== 'settle' || typeof body !== 'object' || body === null
    || !isPaymentRejection(endpoint, body) || 'transaction' in body) return body;
  return { ...body, transaction: '' };
};

const parseFacilitatorBody = <T>(
  body: unknown,
  response: Response,
  schema: { parse(value: unknown): T },
  bodyText: string,
): T => {
  try {
    return schema.parse(body);
  } catch {
    if (!response.ok) throw httpError(response.status, bodyText);
    throw new X402FacilitatorError('FACILITATOR_INVALID_RESPONSE', 'Facilitator returned an invalid response.');
  }
};

export const parseFacilitatorResponse = async <T>(
  response: Response,
  endpoint: 'verify' | 'settle',
  schema: { parse(value: unknown): T },
): Promise<T> => {
  const { body: rawBody, text } = await readFacilitatorBody(response);
  if (!response.ok && ![400, 402, 403].includes(response.status)) throw httpError(response.status, text);
  const body = normalizedRejectionBody(rawBody, response, endpoint);
  const parsed = parseFacilitatorBody(body, response, schema, text);
  if (!response.ok && !isPaymentRejection(endpoint, parsed)) throw httpError(response.status, text);
  return parsed;
};

export const createFacilitatorClient = ({
  url,
  timeoutMs = 10_000,
  fetchImpl = fetch,
}: {
  readonly url: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: (input: string, init: RequestInit) => Promise<Response>;
}): FacilitatorClient => {
  const post = async <T>(endpoint: 'verify' | 'settle', request: VerifyRequest, schema: { parse(value: unknown): T }): Promise<T> => {
    let response: Response;
    try {
      response = await fetchImpl(`${url.replace(/\/$/, '')}/${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ x402Version: 2, paymentPayload: request.paymentPayload, paymentRequirements: request.paymentRequirements }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new X402FacilitatorError('FACILITATOR_REQUEST_FAILED', `Facilitator ${endpoint} request failed.`);
    }
    return parseFacilitatorResponse(response, endpoint, schema);
  };
  return {
    verify: (request) => post('verify', request, verifyResponseSchema),
    settle: (request) => post('settle', request, settleResponseSchema),
  };
};
