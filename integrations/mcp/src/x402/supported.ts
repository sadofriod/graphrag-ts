import type { FacilitatorClient } from './facilitator.ts';

export type SupportedKind = {
  readonly x402Version: number;
  readonly scheme: string;
  readonly network: string;
  readonly extra?: Record<string, unknown>;
};

export type SupportedKinds = {
  readonly kinds: SupportedKind[];
  readonly [key: string]: unknown;
};

const isSupportedKinds = (value: unknown): value is SupportedKinds =>
  typeof value === 'object' && value !== null && 'kinds' in value && Array.isArray(value.kinds);

export const fetchSupportedKinds = async ({
  facilitatorUrl,
  facilitator,
  fetchImpl = fetch,
}: {
  readonly facilitatorUrl: string;
  readonly facilitator: FacilitatorClient;
  readonly fetchImpl?: (input: string, init: RequestInit) => Promise<Response>;
}): Promise<SupportedKinds> => {
  let status: number;
  let json: unknown;
  if (facilitator.request) {
    ({ status, json } = await facilitator.request('supported'));
  } else {
    const response = await fetchImpl(`${facilitatorUrl.replace(/\/$/, '')}/supported`, {
      method: 'GET',
      signal: AbortSignal.timeout(5_000),
    });
    status = response.status;
    try {
      json = await response.json() as unknown;
    } catch {
      throw new Error('Facilitator returned malformed /supported JSON.');
    }
  }
  if (status < 200 || status >= 300) throw new Error(`Facilitator /supported returned HTTP ${status}.`);
  if (!isSupportedKinds(json)) throw new Error('Facilitator returned an invalid /supported response.');
  return json;
};

export const findUptoFacilitatorAddress = (kinds: readonly SupportedKind[], network: string): string | undefined => {
  const kind = kinds.find((candidate) => candidate.x402Version === 2
    && candidate.scheme === 'upto' && candidate.network === network);
  const address = kind?.extra?.facilitatorAddress;
  return typeof address === 'string' ? address : undefined;
};
