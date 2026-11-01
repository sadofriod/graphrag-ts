import { expect, spyOn, test } from 'bun:test';
import { loadConfig } from '../config.ts';
import { createPublicRateLimiter } from './http.ts';

const config = loadConfig({ DATABASE_URL: 'postgresql://localhost/unused' });

test('public rate limits expire individual requests at the exact one-minute boundary', () => {
  const clock = spyOn(Date, 'now').mockReturnValue(1_000);
  const limit = createPublicRateLimiter({ ...config, MCP_PUBLIC_RATE_PER_MIN: 2 });
  try {
    expect(limit('192.0.2.10')).toBeUndefined();
    clock.mockReturnValue(1_500);
    expect(limit('192.0.2.10')).toBeUndefined();
    const blocked = limit('192.0.2.10');
    expect(blocked?.status).toBe(429);
    expect(blocked?.headers.get('retry-after')).toBe('60');

    clock.mockReturnValue(61_000);
    expect(limit('192.0.2.10')).toBeUndefined();
    expect(limit('192.0.2.10')?.headers.get('retry-after')).toBe('1');

    clock.mockReturnValue(121_000);
    expect(limit('192.0.2.10')).toBeUndefined();
    expect(limit('192.0.2.10')).toBeUndefined();
    expect(limit('192.0.2.10')?.status).toBe(429);
  } finally {
    clock.mockRestore();
  }
});

test('public rate limits are isolated by IP and handler instance', () => {
  const appConfig = { ...config, MCP_PUBLIC_RATE_PER_MIN: 1 };
  const first = createPublicRateLimiter(appConfig);
  const second = createPublicRateLimiter(appConfig);
  expect(first('192.0.2.10')).toBeUndefined();
  expect(first('192.0.2.10')?.status).toBe(429);
  expect(first('192.0.2.11')).toBeUndefined();
  expect(second('192.0.2.10')).toBeUndefined();
});
