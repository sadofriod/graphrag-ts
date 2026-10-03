import { describe, expect, it } from 'bun:test';

import { createCommunityHierarchyBuilder } from './communityHierarchy';

describe('createCommunityHierarchyBuilder', () => {
  it('recursively builds only complete strict refinements', async () => {
    const partitions: string[][] = [];
    const buildHierarchy = createCommunityHierarchyBuilder(async (edges) => {
      const members = Array.from(new Set(edges.flatMap(({ source, target }) => [source, target])));
      partitions.push(members);

      if (members.length === 4) {
        return [
          { id: 0, members: ['A', 'B'] },
          { id: 1, members: ['C', 'D'] },
        ];
      }

      return [{ id: 0, members }];
    });

    const hierarchy = await buildHierarchy(
      [
        { source: 'A', target: 'B' },
        { source: 'B', target: 'C' },
        { source: 'C', target: 'D' },
      ],
      [{ id: 0, members: ['A', 'B', 'C', 'D'] }],
    );

    expect(partitions).toEqual([
      ['A', 'B', 'C', 'D'],
      ['A', 'B'],
      ['C', 'D'],
    ]);
    expect(hierarchy).toEqual([
      {
        id: 0,
        level: 0,
        parentId: null,
        members: ['A', 'B', 'C', 'D'],
        children: [
          { id: 1, level: 1, parentId: 0, members: ['A', 'B'], children: [] },
          { id: 2, level: 1, parentId: 0, members: ['C', 'D'], children: [] },
        ],
      },
    ]);
  });

  it('keeps a community as a leaf when a partition omits members', async () => {
    const buildHierarchy = createCommunityHierarchyBuilder(async () => [
      { id: 0, members: ['A'] },
      { id: 1, members: ['B'] },
    ]);

    const hierarchy = await buildHierarchy(
      [{ source: 'A', target: 'B' }],
      [{ id: 0, members: ['A', 'B', 'C'] }],
    );

    expect(hierarchy[0]?.children).toEqual([]);
  });
});