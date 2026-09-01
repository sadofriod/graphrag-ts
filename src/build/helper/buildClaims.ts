import { createHash } from 'node:crypto';

import { prismaClient } from './prismaClient';

export interface ChunkClaim {
  subject: string;
  object?: string;
  description: string;
  childIndex?: number;
}

interface ClaimRow {
  namespace: string;
  subjectEntityId: string;
  objectEntityId?: string;
  description: string;
  descriptionHash: string;
  sourceParentId: string;
  sourceChunkId?: string;
}

interface BuildClaimsOptions {
  parentId: string;
  childIds: readonly string[];
  namespace: string;
}

/** Used only to generate the deduplication hash: trim + lowercase, without collapsing whitespace, to avoid over-merging. */
const normalizeForHash = (text: string) => text.trim().toLowerCase();

export const descriptionHash = (text: string) =>
  createHash('sha256').update(normalizeForHash(text), 'utf8').digest('hex');

const collectEntityNames = (claims: readonly ChunkClaim[]): string[] => {
  const names = new Set<string>();
  for (const claim of claims) {
    const subject = claim.subject.trim();
    if (subject) {
      names.add(subject);
    }
    const object = claim.object?.trim();
    if (object) {
      names.add(object);
    }
  }
  return [...names];
};

const resolveEntityIds = async (names: readonly string[], namespace: string) => {
  const entityIds = new Map<string, string>();
  await Promise.all(
    names.map(async (name) => {
      const record = await prismaClient.rAGEntity.upsert({
        where: { namespace_name: { namespace, name } },
        update: {},
        create: { namespace, name },
      });
      entityIds.set(name, record.id);
    }),
  );
  return entityIds;
};

const resolveSourceChunkId = (
  childIds: readonly string[],
  childIndex: number | undefined,
): string | null => {
  if (childIndex == null || childIndex < 0 || childIndex >= childIds.length) {
    return null;
  }
  return childIds[childIndex] ?? null;
};

const toClaimRows = (
  claims: readonly ChunkClaim[],
  opts: BuildClaimsOptions,
  entityIds: ReadonlyMap<string, string>,
): ClaimRow[] => {
  const rows: ClaimRow[] = [];
  for (const claim of claims) {
    const subject = claim.subject.trim();
    const subjectEntityId = entityIds.get(subject);
    if (!subject || !subjectEntityId) {
      continue;
    }

    const objectName = claim.object?.trim();
    const objectEntityId = objectName ? entityIds.get(objectName) : undefined;
    const sourceChunkId = resolveSourceChunkId(opts.childIds, claim.childIndex);

    rows.push({
      namespace: opts.namespace,
      subjectEntityId,
      ...(objectEntityId ? { objectEntityId } : {}),
      description: claim.description,
      descriptionHash: descriptionHash(claim.description),
      sourceParentId: opts.parentId,
      ...(sourceChunkId ? { sourceChunkId } : {}),
    });
  }
  return rows;
};

export const buildClaims = async (
  claims: readonly ChunkClaim[],
  opts: BuildClaimsOptions,
): Promise<number> => {
  if (claims.length === 0) {
    return 0;
  }

  const entityIds = await resolveEntityIds(collectEntityNames(claims), opts.namespace);
  const rows = toClaimRows(claims, opts, entityIds);

  if (rows.length === 0) {
    return 0;
  }

  const result = await prismaClient.rAGClaim.createMany({
    data: rows,
    skipDuplicates: true,
  });

  return result.count;
};

