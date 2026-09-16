import { describe, expect, it } from 'bun:test';

import {
  computeContentHash,
  diffDocumentsWithExisting,
  diffDocuments,
} from './documentDiff';
import { prismaClient } from '../helper/prismaClient';

describe('documentDiff', () => {
  it('correctly hashes content', () => {
    const hash1 = computeContentHash('hello world');
    const hash2 = computeContentHash('hello world  ');
    const hash3 = computeContentHash('different');

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
  });

  it('classifies documents into toInsert, toUpdate, and toSkip', () => {
    const existing = [
      { id: 'p1', title: 'unchanged.md', content: 'same content' },
      { id: 'p2', title: 'modified.md', content: 'old content' },
    ];

    const inputFiles = [
      { title: 'unchanged.md', content: 'same content' },
      { title: 'modified.md', content: 'new updated content' },
      { title: 'new-file.md', content: 'brand new file' },
      { title: '', content: 'anonymous file' },
    ];

    const diff = diffDocumentsWithExisting(inputFiles, existing);

    expect(diff.toSkip).toHaveLength(1);
    expect(diff.toSkip[0]?.file.title).toBe('unchanged.md');
    expect(diff.toSkip[0]?.existingParentId).toBe('p1');

    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]?.file.title).toBe('modified.md');
    expect(diff.toUpdate[0]?.existingParentId).toBe('p2');

    expect(diff.toInsert).toHaveLength(2);
    expect(diff.toInsert.map((i) => i.file.title)).toEqual(['new-file.md', '']);
  });

  it('groups every stored parent for a document title when deciding updates', () => {
    const diff = diffDocumentsWithExisting(
      [{ title: 'doc.md', content: '# Intro\nalpha\n# Next\nbeta' }],
      [
        { id: 'p1', title: 'doc.md#Intro', content: '# Intro\nalpha' },
        { id: 'p2', title: 'doc.md#Next', content: '# Next\nbeta' },
      ],
    );

    expect(diff.toSkip).toHaveLength(1);
    expect(diff.toSkip[0]?.existingParentIds).toEqual(['p1', 'p2']);
  });

  it('handles empty input files gracefully', async () => {
    const diff = await diffDocuments([], 'ns-test');
    expect(diff).toEqual({ toInsert: [], toUpdate: [], toSkip: [], all: [] });
  });

  it('queries prismaClient when diffDocuments is invoked with files', async () => {
    const originalFindMany = prismaClient.rAGParent.findMany;
    let findWhere: unknown;
    let orderBy: unknown;

    prismaClient.rAGParent.findMany = (((args: { where: object; orderBy?: object[] }) => {
      findWhere = args.where;
      orderBy = args.orderBy;
      return Promise.resolve([
        { id: 'p-1', title: 'existing.md', content: 'alpha' },
      ]);
    }) as unknown) as typeof prismaClient.rAGParent.findMany;

    try {
      const diff = await diffDocuments(
        [
          { title: 'existing.md', content: 'alpha' },
          { title: 'other.md', content: 'beta' },
        ],
        'ns-custom',
      );

      expect(findWhere).toEqual({ namespace: 'ns-custom' });
      expect(orderBy).toEqual([{ title: 'asc' }, { createdAt: 'asc' }]);
      expect(diff.toSkip).toHaveLength(1);
      expect(diff.toInsert).toHaveLength(1);
    } finally {
      prismaClient.rAGParent.findMany = originalFindMany;
    }
  });
});
