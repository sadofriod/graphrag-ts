import { describe, expect, test } from 'bun:test';
import { createQueryLimiter } from './tools.ts';

describe('query limiter', () => {
  test('shares a bounded number of active query slots', () => {
    const limiter = createQueryLimiter(1);
    const release = limiter.tryAcquire();
    expect(typeof release).toBe('function');
    expect(limiter.tryAcquire()).toBeUndefined();

    release?.();
    const replacement = limiter.tryAcquire();
    expect(typeof replacement).toBe('function');
    expect(limiter.tryAcquire()).toBeUndefined();
  });

  test('releasing a slot more than once does not exceed the limit', () => {
    const limiter = createQueryLimiter(1);
    const release = limiter.tryAcquire();
    release?.();
    release?.();

    expect(typeof limiter.tryAcquire()).toBe('function');
    expect(limiter.tryAcquire()).toBeUndefined();
  });
});
