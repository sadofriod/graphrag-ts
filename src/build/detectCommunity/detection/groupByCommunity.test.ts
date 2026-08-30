import { describe, expect, it } from 'bun:test';

import { groupByCommunity } from './groupByCommunity';

describe('groupByCommunity', () => {
  it('groups vertex indices by membership id in ascending id order', () => {
    const communities = groupByCommunity(
      { membership: [0, 0, 0, 1, 1] },
      ['A', 'B', 'C', 'D', 'E'],
    );

    expect(communities).toEqual([
      { id: 0, members: ['A', 'B', 'C'] },
      { id: 1, members: ['D', 'E'] },
    ]);
  });

  it('skips membership entries whose vertex index is out of range', () => {
    const communities = groupByCommunity({ membership: [0, 0, 9] }, ['A', 'B']);

    expect(communities).toEqual([{ id: 0, members: ['A', 'B'] }]);
  });
});
