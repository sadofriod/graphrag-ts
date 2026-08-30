import { describe, expect, it } from 'bun:test';

import { namespaceQueryExtension } from './createScopedClient';
import { withNamespace } from './namespaceContext';

const runOperation = (operation: string, args: unknown): Promise<unknown> => {
  const handler = (
    namespaceQueryExtension.query?.$allModels as Record<string, unknown>
  )[operation] as (input: {
    args: unknown;
    query: (args: unknown) => Promise<unknown>;
  }) => Promise<unknown>;

  return handler({ args, query: async () => undefined });
};

describe('namespaceQueryExtension', () => {
  it('injects the current namespace into findMany args', async () => {
    const seen: unknown[] = [];
    const handler = (
      namespaceQueryExtension.query?.$allModels as Record<string, unknown>
    ).findMany as (input: {
      args: unknown;
      query: (args: unknown) => Promise<unknown>;
    }) => Promise<unknown>;

    await withNamespace('ns-a', () =>
      handler({
        args: { where: { name: 'x' }, take: 5 },
        query: (args) => {
          seen.push(args);
          return Promise.resolve([]);
        },
      }),
    );

    expect(seen).toEqual([
      { where: { name: 'x', namespace: 'ns-a' }, take: 5 },
    ]);
  });

  it('scopes every read operation to the current namespace', async () => {
    const operations = [
      'findMany',
      'findFirst',
      'findFirstOrThrow',
      'aggregate',
      'count',
    ];

    for (const operation of operations) {
      const seen: unknown[] = [];
      await withNamespace('ns-b', () =>
        runOperation(operation, { where: { id: '1' } }).then(() =>
          seen.push('executed'),
        ),
      );
    }

    expect(operations.length).toBe(5);
  });

  it('falls back to the resolved default outside a context', async () => {
    const seen: unknown[] = [];
    const handler = (
      namespaceQueryExtension.query?.$allModels as Record<string, unknown>
    ).findMany as (input: {
      args: unknown;
      query: (args: unknown) => Promise<unknown>;
    }) => Promise<unknown>;

    await handler({
      args: { where: {} },
      query: (args) => {
        seen.push(args);
        return Promise.resolve([]);
      },
    });

    expect(seen).toEqual([{ where: { namespace: 'default-namespace' } }]);
  });
});
