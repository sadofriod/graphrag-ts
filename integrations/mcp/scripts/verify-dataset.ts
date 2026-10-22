import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { verifyDatasetBundle, type DatasetBundleFile } from '../src/dataset/bundle.ts';

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--dir' || args[1] === undefined || args[1].startsWith('--')) {
    throw new Error('Usage: bun scripts/verify-dataset.ts --dir <bundle dir>');
  }
  const directory = args[1];
  const entries = await readdir(directory, { withFileTypes: true });
  const files: DatasetBundleFile[] = await Promise.all(entries.map(async (entry) => ({
    path: entry.name,
    content: entry.isFile() ? await readFile(path.join(directory, entry.name), 'utf8') : '',
  })));
  const result = verifyDatasetBundle(files);
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Dataset verification failed.');
  process.exitCode = 1;
});
