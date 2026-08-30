import type { BuildInputFile } from '../build/buildRag';
import { InputFileError } from './inputError';
import { isTextFile } from './textFile';

export interface FolderImportInput {
  path: string;
  enqueue: (files: readonly BuildInputFile[]) => string;
  /** Directory paths (relative to `path`) to skip during traversal. */
  exclude?: readonly string[];
}

const buildExcluder = (exclude?: readonly string[]) => {
  const dirs = (exclude ?? [])
    .map((dir) => dir.replace(/^\/+|\/+$/g, ''))
    .filter((dir) => dir.length > 0);
  if (dirs.length === 0) {
    return undefined;
  }
  return (relativePath: string) => dirs.some((dir) => relativePath.startsWith(`${dir}/`));
};

export const handleFolderImport = async (input: FolderImportInput): Promise<string> => {
  const { path: dirPath, enqueue, exclude } = input;
  const inputs: BuildInputFile[] = [];
  const isExcluded = buildExcluder(exclude);

  try {
    const glob = new Bun.Glob('**/*');
    for await (const relativePath of glob.scan({ cwd: dirPath, onlyFiles: true })) {
      if (isExcluded?.(relativePath)) {
        continue;
      }
      if (!isTextFile(relativePath)) {
        continue;
      }
      inputs.push({
        title: relativePath,
        content: await Bun.file(`${dirPath}/${relativePath}`).text(),
      });
    }
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === 'ENOENT') {
      throw new InputFileError('Folder not found', 404);
    }
    if (code === 'ENOTDIR') {
      throw new InputFileError('Path is not a directory', 400);
    }
    throw error;
  }

  inputs.sort((a, b) => a.title.localeCompare(b.title));
  return enqueue(inputs);
};
