import { describe, expect, it } from 'bun:test';

import { applyNamespaceToWhere } from './applyNamespaceToWhere';

describe('applyNamespaceToWhere', () => {
  it('adds namespace to an empty where', () => {
    expect(applyNamespaceToWhere({ where: undefined }, 'ns-a')).toEqual({
      where: { namespace: 'ns-a' },
    });
  });

  it('merges namespace into an existing where', () => {
    expect(
      applyNamespaceToWhere({ where: { id: { in: ['a', 'b'] } } }, 'ns-a'),
    ).toEqual({
      where: { id: { in: ['a', 'b'] }, namespace: 'ns-a' },
    });
  });

  it('adds a where clause when args have none', () => {
    expect(applyNamespaceToWhere({ select: { id: true } }, 'ns-a')).toEqual({
      select: { id: true },
      where: { namespace: 'ns-a' },
    });
  });

  it('preserves other top-level args', () => {
    expect(
      applyNamespaceToWhere(
        { where: { name: 'x' }, orderBy: { id: 'asc' }, take: 5 },
        'ns-a',
      ),
    ).toEqual({
      where: { name: 'x', namespace: 'ns-a' },
      orderBy: { id: 'asc' },
      take: 5,
    });
  });

  it('does not mutate the original args object', () => {
    const args = { where: { name: 'x' } };
    const result = applyNamespaceToWhere(args, 'ns-a');

    expect(result).not.toBe(args);
    expect(args).toEqual({ where: { name: 'x' } });
  });
});
