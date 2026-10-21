import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { prismaClient } from '../helper/prismaClient';
import {
  deleteDocumentByParentId,
  deleteDocumentByTitle,
  pruneStaleDocuments,
} from './documentPruner';

describe('documentPruner', () => {
  const transaction = prismaClient.$transaction;
  const queryRaw = prismaClient.$queryRaw;
  const findContributions = prismaClient.rAGEdgeContribution.findMany;
  const deleteContributions = prismaClient.rAGEdgeContribution.deleteMany;
  beforeEach(() => {
    prismaClient.$transaction = (async (
      operation: (client: typeof prismaClient) => Promise<unknown>,
    ) => operation(prismaClient)) as never;
    prismaClient.$queryRaw = (async () => []) as never;
    prismaClient.rAGEdgeContribution.findMany = (async () => []) as never;
    prismaClient.rAGEdgeContribution.deleteMany = (async () => ({ count: 0 })) as never;
  });
  afterEach(() => {
    prismaClient.$transaction = transaction;
    prismaClient.$queryRaw = queryRaw;
    prismaClient.rAGEdgeContribution.findMany = findContributions;
    prismaClient.rAGEdgeContribution.deleteMany = deleteContributions;
  });
  const originalParentFindMany = prismaClient.rAGParent.findMany;
  const originalParentDeleteMany = prismaClient.rAGParent.deleteMany;
  const originalClaimUpdateMany = prismaClient.rAGClaim.updateMany;

  it('removes only the deleted parent contributions and detaches its claims', async () => {
    let parentWhere: unknown;
    let claimWhere: unknown;
    let edgeWhere: unknown;

    prismaClient.rAGClaim.updateMany = (((args: { where: object }) => {
      claimWhere = args.where;
      return Promise.resolve({ count: 3 });
    }) as unknown) as typeof prismaClient.rAGClaim.updateMany;

    prismaClient.rAGEdgeContribution.deleteMany = (((args: { where: object }) => {
      edgeWhere = args.where;
      return Promise.resolve({ count: 2 });
    }) as unknown) as typeof prismaClient.rAGEdgeContribution.deleteMany;

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

    prismaClient.rAGEdgeContribution.deleteMany = (((args: { where: object }) => {
      edgeWhere = args.where;
      return Promise.resolve({ count: 4 });
    }) as unknown) as typeof prismaClient.rAGEdgeContribution.deleteMany;

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
    }
  });

  it('prunes multiple parent IDs', async () => {
    prismaClient.rAGClaim.updateMany = (() =>
      Promise.resolve({ count: 2 })) as typeof prismaClient.rAGClaim.updateMany;
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
    }
  });
});
