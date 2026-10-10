import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig } from './config.ts';

export type JobInput = {
  readonly sourceLabel: string;
  readonly content: string;
  readonly contentHash: string;
  readonly mediaType: 'text/markdown';
};

export class InputError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const makeInput = (sourceLabel: string, content: string): JobInput => ({
  sourceLabel: normalizeSourceLabel(sourceLabel),
  content,
  contentHash: createHash('sha256').update(content).digest('hex'),
  mediaType: 'text/markdown',
});

export const normalizeSourceLabel = (sourceLabel: string): string => {
  const characters = Array.from(sourceLabel);
  if (characters.length <= 255) {
    return sourceLabel;
  }
  const suffix = `-${createHash('sha256').update(sourceLabel).digest('hex').slice(0, 16)}`;
  return `${characters.slice(0, 255 - suffix.length).join('')}${suffix}`;
};

const validateBatch = (inputs: readonly JobInput[], config: AppConfig): void => {
  if (inputs.length === 0) {
    throw new InputError('EMPTY_INPUT', 'No Markdown files were found.');
  }
  if (inputs.length > config.MAX_FILES_PER_JOB) {
    throw new InputError('TOO_MANY_FILES', 'The submission exceeds the configured file-count limit.');
  }

  const totalBytes = inputs.reduce((total, input) => {
    const size = Buffer.byteLength(input.content, 'utf8');
    if (size > config.MAX_FILE_BYTES) {
      throw new InputError('FILE_TOO_LARGE', `Input ${input.sourceLabel} exceeds the per-file size limit.`);
    }
    return total + size;
  }, 0);

  if (totalBytes > config.MAX_JOB_BYTES) {
    throw new InputError('JOB_TOO_LARGE', 'The submission exceeds the configured total size limit.');
  }
};

export const textInput = (text: string, source: string | undefined, config: AppConfig): JobInput[] => {
  const content = text.trim();
  if (!content) {
    throw new InputError('EMPTY_INPUT', 'Text must not be empty.');
  }
  const inputs = [makeInput(source?.trim() || 'remembered-text.md', content)];
  validateBatch(inputs, config);
  return inputs;
};

const parseRelativePath = (requestedPath: string): string[] => {
  if (!requestedPath.trim() || path.isAbsolute(requestedPath) || path.win32.isAbsolute(requestedPath)) {
    throw new InputError('INVALID_PATH', 'Provide a non-empty relative path inside the configured input directory.');
  }

  const segments = requestedPath.replaceAll('\\', '/').split('/');
  if (segments.some((segment) => segment === '..' || segment === '')) {
    throw new InputError('INVALID_PATH', 'Parent-directory traversal and empty path segments are not allowed.');
  }
  return segments;
};

const resolveInputRoot = async (inputRoot: string): Promise<string> =>
  realpath(inputRoot).catch(() => {
    throw new InputError('INPUT_ROOT_UNAVAILABLE', 'The configured input directory is unavailable.');
  });

const resolveRequestedPath = async (root: string, segments: readonly string[]): Promise<string> => {
  let target = root;
  for (const segment of segments) {
    target = path.join(target, segment);
    const details = await lstat(target).catch(() => {
      throw new InputError('PATH_NOT_FOUND', 'The requested path does not exist in the input directory.');
    });
    if (details.isSymbolicLink()) {
      throw new InputError('SYMLINK_NOT_ALLOWED', 'Symbolic links are not accepted as input.');
    }
  }
  return target;
};

const assertInsideRoot = async (root: string, target: string): Promise<string> => {
  const resolved = await realpath(target);
  const relative = path.relative(root, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new InputError('INVALID_PATH', 'The requested path is outside the configured input directory.');
  }
  return resolved;
};

const collectMarkdownFiles = async (directory: string, maxFiles: number): Promise<string[]> => {
  const markdownFiles: string[] = [];
  const visit = async (entry: string): Promise<void> => {
    const details = await lstat(entry);
    if (details.isSymbolicLink()) {
      return;
    }
    if (details.isDirectory()) {
      const children = await readdir(entry, { withFileTypes: true });
      for (const child of children.sort((left, right) => left.name.localeCompare(right.name))) {
        await visit(path.join(entry, child.name));
      }
      return;
    }
    if (details.isFile() && path.extname(entry).toLowerCase() === '.md') {
      markdownFiles.push(entry);
      if (markdownFiles.length > maxFiles) {
        throw new InputError('TOO_MANY_FILES', 'The directory exceeds the configured file-count limit.');
      }
    }
  };
  await visit(directory);
  return markdownFiles;
};

const readMarkdownInputs = async (
  markdownFiles: readonly string[],
  root: string,
  config: AppConfig,
): Promise<JobInput[]> => {
  const inputs: JobInput[] = [];
  let totalBytes = 0;
  for (const file of markdownFiles) {
    const details = await lstat(file);
    if (details.size > config.MAX_FILE_BYTES || totalBytes + details.size > config.MAX_JOB_BYTES) {
      throw new InputError('INPUT_TOO_LARGE', 'The selected Markdown files exceed the configured size limit.');
    }
    const content = await readFile(file, 'utf8');
    const size = Buffer.byteLength(content, 'utf8');
    if (size > config.MAX_FILE_BYTES || totalBytes + size > config.MAX_JOB_BYTES) {
      throw new InputError('INPUT_TOO_LARGE', 'The selected Markdown files exceed the configured size limit.');
    }
    totalBytes += size;
    inputs.push(makeInput(path.relative(root, file).split(path.sep).join('/'), content));
  }

  validateBatch(inputs, config);
  return inputs;
};

export const pathInputs = async (
  requestedPath: string,
  config: AppConfig,
): Promise<JobInput[]> => {
  const segments = parseRelativePath(requestedPath);
  const root = await resolveInputRoot(config.INPUT_ROOT);
  const target = await resolveRequestedPath(root, segments);
  const resolved = await assertInsideRoot(root, target);
  const markdownFiles = await collectMarkdownFiles(resolved, config.MAX_FILES_PER_JOB);
  return readMarkdownInputs(markdownFiles, root, config);
};