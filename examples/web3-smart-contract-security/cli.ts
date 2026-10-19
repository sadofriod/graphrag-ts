import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { writeDelivery } from './export';

const usage = 'bun examples/web3-smart-contract-security/cli.ts --out NEW_DIRECTORY [--input DATASET.json]';

export const runCli = async (args: readonly string[]): Promise<void> => {
  if (args.length === 1 && args[0] === '--help') {
    console.log(usage);
    return;
  }
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if ((key !== '--out' && key !== '--input') || !value || value.startsWith('--') || options.has(key)) {
      throw new Error(usage);
    }
    options.set(key, value);
  }
  const output = options.get('--out');
  if (!output) throw new Error(usage);
  const input = options.get('--input') ?? new URL('./sample.json', import.meta.url);
  const data: unknown = JSON.parse(await readFile(input, 'utf8'));
  await writeDelivery(data, resolve(output));
  console.log(`Created dataset delivery: ${resolve(output)}`);
};

if (import.meta.main) {
  runCli(Bun.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Dataset delivery failed');
    process.exitCode = 1;
  });
}
