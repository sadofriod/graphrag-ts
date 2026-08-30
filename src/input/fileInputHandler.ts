import type { BuildInputFile } from '../build/buildRag';
import { InputFileError } from './inputError';
import { isTextFile, MAX_UPLOAD_SIZE } from './textFile';

export interface UploadedFileInput {
  file: File;
  uploadDir: string;
  enqueue: (files: readonly BuildInputFile[]) => string;
}

export const handleUploadedFile = async (input: UploadedFileInput): Promise<string> => {
  const { file, uploadDir, enqueue } = input;

  if (!isTextFile(file.name)) {
    throw new InputFileError(`Unsupported file type: ${file.name}`, 415);
  }
  if (file.size > MAX_UPLOAD_SIZE) {
    throw new InputFileError('File too large (max 2MB)', 413);
  }

  const content = await file.text();
  await Bun.write(`${uploadDir}/${file.name}`, content);

  return enqueue([{ title: file.name, content }]);
};
