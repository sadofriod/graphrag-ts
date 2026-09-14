import { describe, expect, it } from 'bun:test';

import { prismaClient } from '../helper/prismaClient';
import {
  deleteDocumentByParentId,
  deleteDocumentByTitle,
  pruneStaleDocuments,
} from './documentPruner';

describe('documentPruner', () => {
  const originalParentFindMany = prismaClient.rAGParent.findMany;
  const originalParentDeleteMany = prismaClient.rAGParent.deleteMany;
  const originalClaimDeleteMany = prismaClient.rAGClaim.deleteMany;

  it('deletes document and claims by parentId', async () => {
    let parentWhere: unknown;
    let claimWhere: unknown;

    prismaClient.rAGClaim.deleteMany = ((args: { where: object }) => {
      claimWhere = args.where;
      return Promise.resolve({ count: 3 });
    }) as typeof prismaClient.rAGClaim.deleteMany;

    prismaClient.rAGParent.deleteMany = ((args: { where: object }) => {
      parentWhere = args.where;
      return Promise.resolve({ count: 1 });
    }) as typeof prismaClient.rAGParent.deleteMany;

    try {
      const result = await deleteDocumentByParentId('p-123', 'ns-test');

      expect(parentWhere).toEqual({ id: 'p-123', namespace: 'ns-test' });
      expect(claimWhere).toEqual({ sourceParentId: 'p-123', namespace: 'ns-test' });
      expect(result).toEqual({ deletedParents: 1, deletedClaims: 3 });
    } finally {
      prismaClient.rAGParent.deleteMany = originalParentDeleteMany;
      prismaClient.rAGClaim.deleteMany = originalClaimDeleteMany;
    }
  });

  it('deletes document and claims by title', async () => {
    let parentWhere: unknown;
    let claimWhere: unknown;

    prismaClient.rAGParent.findMany = (() =>
      Promise.resolve([{ id: 'p-1' }, { id: 'p-2' }])) as typeof prismaClient.rAGParent.findMany;

    prismaClient.rAGClaim.deleteMany = ((args: { where: object }) => {
      claimWhere = args.where;
      return Promise.resolve({ count: 5 });
    }) as typeof prismaClient.rAGClaim.deleteMany;

    prismaClient.rAGParent.deleteMany = ((args: { where: object }) => {
      parentWhere = args.where;
      return Promise.resolve({ count: 2 });
    }) as typeof prismaClient.rAGParent.deleteMany;

    try {
      const result = await deleteDocumentByTitle('doc.md', 'ns-test');

      expect(claimWhere).toEqual({ sourceParentId: { in: ['p-1', 'p-2'] }, namespace: 'ns-test' });
      expect(parentWhere).toEqual({ id: { in: ['p-1', 'p-2'] }, namespace: 'ns-test' });
      expect(result).toEqual({ deletedParents: 2, deletedClaims: 5 });
    } finally {
      prismaClient.rAGParent.findMany = originalParentFindMany;
      prismaClient.rAGParent.deleteMany = originalParentDeleteMany;
      prismaClient.rAGClaim.deleteMany = originalClaimDeleteMany;
    }
  });

  it('prunes multiple parent IDs', async () => {
    prismaClient.rAGClaim.deleteMany = (() =>
      Promise.resolve({ count: 2 })) as typeof prismaClient.rAGClaim.deleteMany;
    prismaClient.rAGParent.deleteMany = (() =>
      Promise.resolve({ count: 2 })) as typeof prismaClient.rAGParent.deleteMany;

    try {
      const result = await pruneStaleDocuments(['p-1', 'p-2'], 'ns-test');
      expect(result).toEqual({ deletedParents: 2, deletedClaims: 2 });

      const emptyResult = await pruneStaleDocuments([], 'ns-test');
      expect(emptyResult).toEqual({ deletedParents: 0, deletedClaims: 0 });
    } finally {
      prismaClient.rAGParent.deleteMany = originalParentDeleteMany;
      prismaClient.rAGClaim.deleteMany = originalClaimDeleteMany;
    }
  });
});
