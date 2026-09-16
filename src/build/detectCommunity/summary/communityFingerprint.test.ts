import { describe, expect, it } from 'bun:test';

import { computeCommunityFingerprint } from './communityFingerprint';

describe('computeCommunityFingerprint', () => {
  it('produces identical fingerprints regardless of input array ordering', () => {
    const input1 = {
      members: ['Alice', 'Bob'],
      entities: [
        { name: 'Alice', description: 'Engineer' },
        { name: 'Bob', description: 'Designer' },
      ],
      edges: [{ source: 'Alice', target: 'Bob', relationshipDesc: 'colleagues' }],
      claims: [{ subject: 'Alice', object: 'Bob', description: 'works with' }],
    };

    const input2 = {
      members: ['Bob', 'Alice'],
      entities: [
        { name: 'Bob', description: 'Designer' },
        { name: 'Alice', description: 'Engineer' },
      ],
      edges: [{ source: 'Alice', target: 'Bob', relationshipDesc: 'colleagues' }],
      claims: [{ subject: 'Alice', object: 'Bob', description: 'works with' }],
    };

    expect(computeCommunityFingerprint(input1)).toBe(computeCommunityFingerprint(input2));
  });

  it('produces different fingerprints when content or claims change', () => {
    const base = {
      members: ['Alice', 'Bob'],
      entities: [{ name: 'Alice' }, { name: 'Bob' }],
      edges: [{ source: 'Alice', target: 'Bob', relationshipDesc: 'colleagues' }],
      claims: [{ subject: 'Alice', description: 'is leader' }],
    };

    const modified = {
      ...base,
      claims: [{ subject: 'Alice', description: 'is manager' }],
    };

    expect(computeCommunityFingerprint(base)).not.toBe(computeCommunityFingerprint(modified));
  });
});
