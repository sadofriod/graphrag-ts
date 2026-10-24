import { describe, expect, test } from 'bun:test';
import { withQuerySlot } from './slot.ts';

describe('withQuerySlot', () => {
  test('releases once on success', async () => {
    let releases = 0;
    await withQuerySlot({ tryAcquire: () => () => { releases++; } }, () => 'busy', async () => 'ok');
    expect(releases).toBe(1);
  });

  test('releases once when work throws', async () => {
    let releases = 0;
    await expect(withQuerySlot({ tryAcquire: () => () => { releases++; } }, () => 'busy', async () => {
      throw new Error('work failed');
    })).rejects.toThrow('work failed');
    expect(releases).toBe(1);
  });

  test('releaseAfter defers release until the promise settles', async () => {
    let releases = 0;
    let finish!: () => void;
    const completion = new Promise<void>((resolve) => { finish = resolve; });
    await withQuerySlot({ tryAcquire: () => () => { releases++; } }, () => 'busy', async (slot) => {
      slot.releaseAfter(completion);
      return 'handed off';
    });
    expect(releases).toBe(0);
    finish();
    await completion;
    await Promise.resolve();
    expect(releases).toBe(1);
  });

  test('onBusy path never acquires', async () => {
    let worked = false;
    const result = await withQuerySlot({ tryAcquire: () => undefined }, () => 'busy', async () => { worked = true; return 'work'; });
    expect(result).toBe('busy');
    expect(worked).toBe(false);
  });
});
