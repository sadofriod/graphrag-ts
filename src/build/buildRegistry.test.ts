import { describe, expect, it } from 'bun:test';

import { createBuildRegistry } from './buildRegistry';

describe('buildRegistry', () => {
  it('creates a pending job and makes it retrievable by id', () => {
    const registry = createBuildRegistry();

    const id = registry.create({ title: 'file-a.md', namespace: 'default-namespace' });

    const job = registry.get(id);
    expect(job?.title).toBe('file-a.md');
    expect(job?.namespace).toBe('default-namespace');
    expect(job?.status).toBe('pending');
    expect(job?.createdAt).toBeTypeOf('number');
    expect(id).toBeTypeOf('string');
  });

  it('updates job status and records the finish time', () => {
    const registry = createBuildRegistry();
    const id = registry.create({ title: 'doc.txt', namespace: 'default-namespace' });

    registry.update(id, { status: 'succeeded', finishedAt: 123 });

    expect(registry.get(id)?.status).toBe('succeeded');
    expect(registry.get(id)?.finishedAt).toBe(123);
  });

  it('records an error message on failure', () => {
    const registry = createBuildRegistry();
    const id = registry.create({ title: 'broken.txt', namespace: 'default-namespace' });

    registry.update(id, { status: 'failed', error: 'LLM timeout' });

    expect(registry.get(id)?.status).toBe('failed');
    expect(registry.get(id)?.error).toBe('LLM timeout');
  });

  it('returns undefined for an unknown build id', () => {
    const registry = createBuildRegistry();

    expect(registry.get('missing')).toBeUndefined();
  });

  it('does nothing when updating an unknown build id', () => {
    const registry = createBuildRegistry();

    expect(() => registry.update('missing', { status: 'running' })).not.toThrow();
  });
});
