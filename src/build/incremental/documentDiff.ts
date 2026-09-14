import { createHash } from 'node:crypto';

import type { BuildInputFile } from '../buildRag';
import { prismaClient } from '../helper/prismaClient';

export type DocumentDiffAction = 'insert' | 'update' | 'skip';

export interface DocumentDiffItem {
  readonly file: BuildInputFile;
  readonly action: DocumentDiffAction;
  readonly existingParentId?: string;
}

export interface DocumentDiffSummary {
  readonly toInsert: readonly DocumentDiffItem[];
  readonly toUpdate: readonly DocumentDiffItem[];
  readonly toSkip: readonly DocumentDiffItem[];
  readonly all: readonly DocumentDiffItem[];
}

export const computeContentHash = (content: string): string =>
  createHash('sha256').update(content.trim(), 'utf8').digest('hex');

interface ExistingParentRecord {
  readonly id: string;
  readonly title: string | null;
  readonly content: string;
}

export const diffDocumentsWithExisting = (
  files: readonly BuildInputFile[],
  existingParents: readonly ExistingParentRecord[],
): DocumentDiffSummary => {
  const existingByTitle = new Map<string, ExistingParentRecord>();
  for (const parent of existingParents) {
    if (parent.title) {
      existingByTitle.set(parent.title, parent);
    }
  }

  const all: DocumentDiffItem[] = files.map((file) => {
    const existing = file.title ? existingByTitle.get(file.title) : undefined;
    if (!existing) {
      return { file, action: 'insert' };
    }

    const isIdentical =
      existing.content === file.content ||
      computeContentHash(existing.content) === computeContentHash(file.content);

    if (isIdentical) {
      return { file, action: 'skip', existingParentId: existing.id };
    }

    return { file, action: 'update', existingParentId: existing.id };
  });

  const toInsert = all.filter((item) => item.action === 'insert');
  const toUpdate = all.filter((item) => item.action === 'update');
  const toSkip = all.filter((item) => item.action === 'skip');

  return { toInsert, toUpdate, toSkip, all };
};

export const diffDocuments = async (
  files: readonly BuildInputFile[],
  namespace: string,
): Promise<DocumentDiffSummary> => {
  if (files.length === 0) {
    return { toInsert: [], toUpdate: [], toSkip: [], all: [] };
  }

  const existingParents = await prismaClient.rAGParent.findMany({
    where: { namespace },
    select: { id: true, title: true, content: true },
  });

  return diffDocumentsWithExisting(files, existingParents);
};
