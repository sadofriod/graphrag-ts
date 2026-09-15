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
  const originalClaimUpdateMany = prismaClient.rAGClaim.updateMany;
  const originalEdgeUpdateMany = prismaClient.rAGGraphEdge.updateMany;

  it('detaches graph rows before deleting by parentId', async () => {
    let parentWhere: unknown;
    let claimWhere: unknown;
    let edgeWhere: unknown;

    prismaClient.rAGClaim.updateMany = (((args: { where: object }) => {
      claimWhere = args.where;
      return Promise.resolve({ count: 3 });
    }) as unknown) as typeof prismaClient.rAGClaim.updateMany;

    prismaClient.rAGGraphEdge.updateMany = (((args: { where: object }) => {
      edgeWhere = args.where;
      return Promise.resolve({ count: 2 });
    }) as unknown) as typeof prismaClient.rAGGraphEdge.updateMany;

    prismaClient.rAGParent.deleteMany = (((args: { where: object }) => {
      parentWhere = args.where;
      return Promise.resolve({ count: 1 });
    }) as unknown) as typeof prismaClient.rAGParent.deleteMany;

    try {
      const result = await deleteDocumentByParentId('p-123', 'ns-test');

      expect(parentWhere).toEqual({ id: { in: ['p-123'] }, namespace: 'ns-test' });
      expect(claimWhere).toEqual({ sourceParentId: { in: ['p-123'] }, namespace: 'ns-test' });
      expect(edgeWhere).toEqual({ parentId: { in: ['p-123'] }, namespace: 'ns-test' });
      expect(result).toEqual({ deletedParents: 1, deletedClaims: 0 });
    } finally {
      prismaClient.rAGParent.deleteMany = originalParentDeleteMany;
      prismaClient.rAGClaim.updateMany = originalClaimUpdateMany;
      prismaClient.rAGGraphEdge.updateMany = originalEdgeUpdateMany;
    }
  });

  it('deletes every stored parent for a title', async () => {
    let parentWhere: unknown;
    let claimWhere: unknown;
    let edgeWhere: unknown;

    prismaClient.rAGParent.findMany = (() =>
      Promise.resolve([{ id: 'p-1' }, { id: 'p-2' }])) as typeof prismaClient.rAGParent.findMany;

    prismaClient.rAGClaim.updateMany = (((args: { where: object }) => {
      claimWhere = args.where;
      return Promise.resolve({ count: 5 });
    }) as unknown) as typeof prismaClient.rAGClaim.updateMany;

    prismaClient.rAGGraphEdge.updateMany = (((args: { where: object }) => {
      edgeWhere = args.where;
      return Promise.resolve({ count: 4 });
    }) as unknown) as typeof prismaClient.rAGGraphEdge.updateMany;

    prismaClient.rAGParent.deleteMany = (((args: { where: object }) => {
      parentWhere = args.where;
      return Promise.resolve({ count: 2 });
    }) as unknown) as typeof prismaClient.rAGParent.deleteMany;

    try {
      const result = await deleteDocumentByTitle('doc.md', 'ns-test');

      expect(claimWhere).toEqual({ sourceParentId: { in: ['p-1', 'p-2'] }, namespace: 'ns-test' });
      expect(edgeWhere).toEqual({ parentId: { in: ['p-1', 'p-2'] }, namespace: 'ns-test' });
      expect(parentWhere).toEqual({ id: { in: ['p-1', 'p-2'] }, namespace: 'ns-test' });
      expect(result).toEqual({ deletedParents: 2, deletedClaims: 0 });
    } finally {
      prismaClient.rAGParent.findMany = originalParentFindMany;
      prismaClient.rAGParent.deleteMany = originalParentDeleteMany;
      prismaClient.rAGClaim.updateMany = originalClaimUpdateMany;
      prismaClient.rAGGraphEdge.updateMany = originalEdgeUpdateMany;
    }
  });

  it('prunes multiple parent IDs', async () => {
    prismaClient.rAGClaim.updateMany = (() =>
      Promise.resolve({ count: 2 })) as typeof prismaClient.rAGClaim.updateMany;
    prismaClient.rAGGraphEdge.updateMany = (() =>
      Promise.resolve({ count: 2 })) as typeof prismaClient.rAGGraphEdge.updateMany;
    prismaClient.rAGParent.deleteMany = (() =>
      Promise.resolve({ count: 2 })) as typeof prismaClient.rAGParent.deleteMany;

    try {
      const result = await pruneStaleDocuments(['p-1', 'p-2'], 'ns-test');
      expect(result).toEqual({ deletedParents: 2, deletedClaims: 0 });

      const emptyResult = await pruneStaleDocuments([], 'ns-test');
      expect(emptyResult).toEqual({ deletedParents: 0, deletedClaims: 0 });
    } finally {
      prismaClient.rAGParent.deleteMany = originalParentDeleteMany;
      prismaClient.rAGClaim.updateMany = originalClaimUpdateMany;
      prismaClient.rAGGraphEdge.updateMany = originalEdgeUpdateMany;
    }
  });
});
