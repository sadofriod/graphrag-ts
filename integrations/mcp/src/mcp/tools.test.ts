import { describe, expect, test } from 'bun:test';
import { communityLevelSchema, createQueryLimiter, globalCommunityLevelSchema } from './tools.ts';

describe('community level schema', () => {
  test('accepts an exact level or all terminal communities', () => {
    expect(communityLevelSchema.parse(2)).toBe(2);
    expect(communityLevelSchema.parse(undefined)).toBeUndefined();
    expect(() => communityLevelSchema.parse(-1)).toThrow();
    expect(() => communityLevelSchema.parse('leaf')).toThrow();
    expect(globalCommunityLevelSchema.parse(2)).toBe(2);
    expect(globalCommunityLevelSchema.parse('leaf')).toBe('leaf');
    expect(globalCommunityLevelSchema.parse(undefined)).toBeUndefined();
  });
});

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
