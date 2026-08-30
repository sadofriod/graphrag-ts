import { describe, expect, it } from 'bun:test';

import type { BuildRegistry } from './buildRegistry';
import { createBuildRegistry } from './buildRegistry';
import { getCurrentNamespace } from '../namespace/namespaceContext';
import { startBuild } from './startBuild';

const waitForFinish = async (registry: BuildRegistry, id: string) => {
  for (let i = 0; i < 100; i += 1) {
    if (registry.get(id)?.status !== 'running') {
      return;
    }
    await Bun.sleep(1);
  }
};

describe('startBuild', () => {
  it('creates a running job and succeeds when the runner resolves', async () => {
    const registry = createBuildRegistry();
    let runnerFiles: unknown;
    let runnerNamespace: string | undefined;
    let runnerContextNamespace: string | undefined;

    const id = startBuild([{ title: 'a.md', content: 'x' }], registry, 'ns-a', {
      runner: async (files, namespace) => {
        runnerFiles = files;
        runnerNamespace = namespace;
        runnerContextNamespace = getCurrentNamespace();
        return { files: 1, parents: 1, edges: 0, claims: 0, communities: 0 };
      },
    });

    expect(registry.get(id)?.status).toBe('running');

    await waitForFinish(registry, id);

    expect(runnerFiles).toEqual([{ title: 'a.md', content: 'x' }]);
    expect(runnerNamespace).toBe('ns-a');
    expect(runnerContextNamespace).toBe('ns-a');
    expect(registry.get(id)?.status).toBe('succeeded');
    expect(registry.get(id)?.finishedAt).toBeTypeOf('number');
  });

  it('marks the job failed with the error message when the runner rejects', async () => {
    const registry = createBuildRegistry();

    const id = startBuild([{ title: 'a.md', content: 'x' }], registry, 'ns-a', {
      runner: async () => {
        throw new Error('LLM timeout');
      },
    });

    await waitForFinish(registry, id);

    expect(registry.get(id)?.status).toBe('failed');
    expect(registry.get(id)?.error).toBe('LLM timeout');
  });

  it('derives the job title from the single file name', () => {
    const registry = createBuildRegistry();

    const id = startBuild([{ title: 'doc.md', content: 'x' }], registry, 'ns-a', {
      runner: async () => ({ files: 1, parents: 0, edges: 0, claims: 0, communities: 0 }),
    });

    expect(registry.get(id)?.title).toBe('doc.md');
  });
});
