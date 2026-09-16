import { CryptoHasher } from 'bun';

import type { BuildInputFile } from '../buildRag';
import { prismaClient } from '../helper/prismaClient';
import { withNamespace } from '../../namespace/namespaceContext';

export type DocumentDiffAction = 'insert' | 'update' | 'skip';

export interface DocumentDiffItem {
  file: BuildInputFile;
  action: DocumentDiffAction;
  existingParentId?: string;
  existingParentIds?: string[];
}

export interface DocumentDiffSummary {
  toInsert: DocumentDiffItem[];
  toUpdate: DocumentDiffItem[];
  toSkip: DocumentDiffItem[];
  all: DocumentDiffItem[];
}

export const computeContentHash = (content: string): string =>
  new CryptoHasher('sha256').update(content.trim(), 'utf8').digest('hex');

interface ExistingParentRecord {
  id: string;
  title: string | null;
  content: string;
}

interface ExistingDocumentRecord {
  parentIds: string[];
  content: string;
}

const resolveDocumentTitle = (
  title: string,
  fileTitles: ReadonlySet<string>,
): string => {
  const sectionIndex = title.indexOf('#');
  if (sectionIndex === -1) {
    return title;
  }

  const baseTitle = title.slice(0, sectionIndex);
  return fileTitles.has(baseTitle) ? baseTitle : title;
};

export const diffDocumentsWithExisting = (
  files: readonly BuildInputFile[],
  existingParents: readonly ExistingParentRecord[],
): DocumentDiffSummary => {
  const fileTitles = new Set(files.map((file) => file.title).filter((title): title is string => title.length > 0));
  const existingByTitle = new Map<string, ExistingDocumentRecord>();
  for (const parent of existingParents) {
    if (parent.title) {
      const title = resolveDocumentTitle(parent.title, fileTitles);
      const current = existingByTitle.get(title);
      existingByTitle.set(title, {
        parentIds: [...(current?.parentIds ?? []), parent.id],
        content: current ? `${current.content}\n${parent.content}` : parent.content,
      });
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
      return {
        file,
        action: 'skip',
        existingParentId: existing.parentIds[0]!,
        existingParentIds: existing.parentIds,
      };
    }

    return {
      file,
      action: 'update',
      existingParentId: existing.parentIds[0]!,
      existingParentIds: existing.parentIds,
    };
  });

  const toInsert = all.filter((item) => item.action === 'insert');
  const toUpdate = all.filter((item) => item.action === 'update');
  const toSkip = all.filter((item) => item.action === 'skip');

  return { toInsert, toUpdate, toSkip, all };
};

export const diffDocuments = async (
  files: readonly BuildInputFile[],
  namespace: string,
): Promise<DocumentDiffSummary> =>
  withNamespace(namespace, async () => {
    if (files.length === 0) {
      return { toInsert: [], toUpdate: [], toSkip: [], all: [] };
    }

    const existingParents = await prismaClient.rAGParent.findMany({
      where: { namespace },
      orderBy: [{ title: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, title: true, content: true },
    });

    return diffDocumentsWithExisting(files, existingParents);
  });
