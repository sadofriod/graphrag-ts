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
    if (!response.ok) throw new X402FacilitatorError('FACILITATOR_HTTP', `Facilitator returned HTTP ${response.status}.`, response.status);
    let body: unknown;
    try { body = await response.json() as unknown; } catch {
      throw new X402FacilitatorError('FACILITATOR_INVALID_RESPONSE', 'Facilitator returned malformed JSON.');
    }
    try { return schema.parse(body); } catch {
      throw new X402FacilitatorError('FACILITATOR_INVALID_RESPONSE', 'Facilitator returned an invalid response.');
    }
  };
  return {
    verify: (request) => post('verify', request, verifyResponseSchema),
    settle: (request) => post('settle', request, settleResponseSchema),
  };
};
