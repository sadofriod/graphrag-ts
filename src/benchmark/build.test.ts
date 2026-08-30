import { describe, expect, it } from 'bun:test';

import type { BuildJob } from '../build/buildRegistry';
import type { RagApiClient } from './client';
import { buildAndWait } from './build';

const jobOf = (status: BuildJob['status'], error?: string): BuildJob => ({
  id: 'build-1',
  status,
  title: 't',
  namespace: 'ns-1',
  createdAt: 0,
  ...(error !== undefined ? { error } : {}),
});

const makeClient = (jobs: readonly BuildJob[]): RagApiClient => {
  let index = 0;
  return {
    buildFolder: async ({ path }) => `build-${path}`,
    getBuild: async () => {
      const job = jobs[Math.min(index, jobs.length - 1)];
      index += 1;
      return job ?? jobOf('succeeded');
    },
    retrieve: async () => {
      throw new Error('retrieve not used in build tests');
    },
  };
};

describe('buildAndWait', () => {
  it('returns the buildId when the build succeeds', async () => {
    const client = makeClient([jobOf('succeeded')]);
    const buildId = await buildAndWait(client, {
      namespace: 'ns-1',
      outlinePath: '/outline',
      pollIntervalMs: 1,
    });
    expect(buildId).toBe('build-/outline');
  });

  it('polls until the build succeeds', async () => {
    const client = makeClient([jobOf('pending'), jobOf('running'), jobOf('succeeded')]);
    const buildId = await buildAndWait(client, {
      namespace: 'ns-1',
      outlinePath: '/outline',
      pollIntervalMs: 1,
    });
    expect(buildId).toBe('build-/outline');
  });

  it('throws when the build fails', async () => {
    const client = makeClient([jobOf('failed', 'boom')]);
    await expect(
      buildAndWait(client, { namespace: 'ns-1', outlinePath: '/outline', pollIntervalMs: 1 }),
    ).rejects.toThrow('RAG build failed: boom');
  });

  it('throws when the build times out', async () => {
    const client = makeClient([jobOf('pending')]);
    await expect(
      buildAndWait(client, {
        namespace: 'ns-1',
        outlinePath: '/outline',
        pollIntervalMs: 1,
        buildTimeoutMs: 20,
      }),
    ).rejects.toThrow('RAG build timed out');
  });
});
