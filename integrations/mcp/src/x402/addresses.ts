const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_VALUES = new Map([...BASE58_ALPHABET].map((character, index) => [character, BigInt(index)]));

export const networkFamily = (network: string): 'evm' | 'solana' | 'other' => {
  if (network.startsWith('eip155:')) return 'evm';
  if (network.startsWith('solana:')) return 'solana';
  return 'other';
};

export const isEvmAddress = (value: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(value);

const decodeBase58 = (value: string): number[] | undefined => {
  let decoded = 0n;
  for (const character of value) {
    const digit = BASE58_VALUES.get(character);
    if (digit === undefined) return undefined;
    decoded = decoded * 58n + digit;
  }

  const bytes: number[] = [];
  while (decoded > 0n) {
    bytes.unshift(Number(decoded % 256n));
    decoded /= 256n;
  }
  const leadingZeroes = [...value].findIndex((character) => character !== '1');
  const zeroCount = leadingZeroes === -1 ? value.length : leadingZeroes;
  return [...Array<number>(zeroCount).fill(0), ...bytes];
};

export const isSolanaAddress = (value: string): boolean => decodeBase58(value)?.length === 32;

const describeValue = (value: string): string => {
  const preview = value.startsWith('0x') && value.length > 10
    ? ` (${value.slice(0, 6)}…${value.slice(-4)})`
    : '';
  return `a ${value.length}-character value${preview}`;
};

const assertAddress = (variable: 'X402_PAY_TO' | 'X402_ASSET', network: string, value: string): string => {
  const trimmed = value.trim();
  const family = networkFamily(network);
  const valid = family === 'evm' ? isEvmAddress(trimmed) : family === 'solana' && isSolanaAddress(trimmed);
  const expected = family === 'evm'
    ? 'an EVM address (0x + 40 hex characters)'
    : family === 'solana'
      ? 'a Solana address (base58-encoded 32 bytes)'
      : 'an address on a supported EVM or Solana network';
  if (!valid) {
    const familyName = family === 'evm' ? 'EVM' : family === 'solana' ? 'Solana' : 'supported';
    throw new Error(`${variable} must be ${expected} for network ${network}; got ${describeValue(trimmed)} that is not a ${familyName} address.`);
  }
  return trimmed;
};

export const assertPayee = (network: string, payTo: string): string => assertAddress('X402_PAY_TO', network, payTo);

export const assertAsset = (network: string, asset: string): string => assertAddress('X402_ASSET', network, asset);
