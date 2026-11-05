import type { OsvClient, OsvPackageInput, OsvScanResult } from './osv.ts';

export type DependencyScanInput = string | OsvPackageInput | { name?: string | undefined; version?: string | undefined; ecosystem?: string | undefined };

export const runDependencyScan = (client: OsvClient, inputs: readonly DependencyScanInput[], maxItems: number, ecosystemDefault = 'npm'): Promise<OsvScanResult> => {
  if (inputs.length === 0) throw new Error('At least one package is required.');
  if (inputs.length > maxItems) throw new Error(`Dependency scan supports at most ${maxItems} packages.`);
  return client.scan(inputs, ecosystemDefault);
};
