import type { BuildInputFile } from '../build/buildRag';
import { InputFileError } from './inputError';
import { isTextFile } from './textFile';

export interface FilePathImportInput {
  path: string;
  enqueue: (files: readonly BuildInputFile[]) => string;
}

export const handleFilePathImport = async (input: FilePathImportInput): Promise<string> => {
  const { path: filePath, enqueue } = input;
  const fileName = filePath.slice(filePath.lastIndexOf('/') + 1);

  if (!isTextFile(fileName)) {
    throw new InputFileError(`Unsupported file type: ${fileName}`, 415);
  }

  let content: string;
  try {
    content = await Bun.file(filePath).text();
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === 'ENOENT') {
      throw new InputFileError('File not found', 404);
    }
    if (code === 'EISDIR') {
      throw new InputFileError('Path is not a file', 400);
    }
    throw error;
  }

  return enqueue([{ title: fileName, content }]);
};
