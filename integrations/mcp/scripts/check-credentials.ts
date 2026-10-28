import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { findCredentialLeaks, formatLeaks } from '../src/ops/credentials.ts';

const execFileAsync = promisify(execFile);
const MAX_FILE_SIZE = 1024 * 1024;
const SKIPPED_BASENAMES = new Set(['bun.lock', 'pnpm-lock.yaml', 'package-lock.json']);
const SKIPPED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.lock']);

const shouldSkip = (filePath: string): boolean => {
  const parts = filePath.split('/');
  const basename = parts.at(-1) ?? '';
  return parts.includes('node_modules')
    || SKIPPED_BASENAMES.has(basename)
    || SKIPPED_EXTENSIONS.has(path.posix.extname(basename).toLowerCase());
};

const main = async (): Promise<void> => {
  const { stdout: rootOutput } = await execFileAsync('git', ['rev-parse', '--show-toplevel']);
  const root = rootOutput.trim();
  const { stdout: trackedOutput } = await execFileAsync('git', ['ls-files', '-z'], { cwd: root, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
  const paths = trackedOutput.toString('utf8').split('\0').filter((filePath) => filePath !== '' && !shouldSkip(filePath));
  const files: { path: string; content: string }[] = [];

  for (const filePath of paths) {
    const handle = await open(path.join(root, filePath), 'r').catch(() => null);
    if (handle === null) continue;
    try {
      const buffer = Buffer.alloc(MAX_FILE_SIZE);
      const { bytesRead } = await handle.read(buffer, 0, MAX_FILE_SIZE, 0);
      files.push({ path: filePath, content: buffer.subarray(0, bytesRead).toString('utf8') });
    } finally {
      await handle.close();
    }
  }

  const leaks = findCredentialLeaks(files);
  if (leaks.length > 0) {
    console.log(formatLeaks(leaks));
    process.exitCode = 1;
  } else {
    console.log(`No committed credentials found in ${files.length} files.`);
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Credential check failed.');
  process.exitCode = 1;
});
