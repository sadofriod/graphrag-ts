import { describe, expect, it } from 'bun:test';

import { buildCommunityContextInput } from './buildCommunityContextInput';
import type { Community } from '../types';

describe('buildCommunityContextInput', () => {
  const community: Community = { id: 0, members: ['A', 'B'] };
  const edgeRows = [
    { id: 'e1', sourceEntity: { name: 'A' }, targetEntity: { name: 'B' }, relationshipDesc: 'allies' },
    { id: 'e2', sourceEntity: { name: 'C' }, targetEntity: { name: 'D' }, relationshipDesc: 'rivals' },
  ];
  const claimRows = [
    { id: 'c1', subjectEntity: { name: 'A' }, objectEntity: { name: 'B' }, description: 'A leads B' },
    { id: 'c2', subjectEntity: { name: 'X' }, objectEntity: null, description: 'X is alone' },
  ];
  const entityDescriptions = new Map<string, string | null>([
    ['A', 'the protagonist'],
    ['B', null],
  ]);

  it('keeps only edges and claims touching community members', () => {
    const input = buildCommunityContextInput(community, edgeRows, claimRows, entityDescriptions);

    expect(input.members).toEqual(['A', 'B']);
    expect(input.edges).toEqual([{ source: 'A', target: 'B', relationshipDesc: 'allies' }]);
    expect(input.claims).toEqual([{ subject: 'A', object: 'B', description: 'A leads B' }]);
  });

  it('includes entity descriptions only when present', () => {
    const input = buildCommunityContextInput(community, [], [], entityDescriptions);

    expect(input.entities).toEqual([
      { name: 'A', description: 'the protagonist' },
      { name: 'B' },
    ]);
  });
});
