import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';
import { integrityToolPrices } from './mcp/tools.ts';

const registryUrl = new URL('../datasets.example.json', import.meta.url);

describe('MCP paywall prices match the dataset registry', () => {
  test('advertised prices match each judgment dataset per-call price', () => {
    expect(existsSync(registryUrl)).toBe(true);
    const registry = JSON.parse(readFileSync(registryUrl, 'utf8')) as {
      datasets: { id: string; pricing?: { per_call?: string } }[];
    };

    for (const id of ['retraction-propagation', 'retraction-evidence-audit'] as const) {
      const dataset = registry.datasets.find((entry) => entry.id === id);
      expect(dataset, `dataset registry must include ${id}`).toBeDefined();
      expect(dataset?.pricing?.per_call).toBeDefined();

      const usd = dataset?.pricing?.per_call as string;
      const match = /^\$(\d+)\.(\d{2})$/.exec(usd);
      expect(match, `${id} per_call must use the $X.YZ format`).not.toBeNull();
      const atomic = (BigInt(match![1]!) * 1_000_000n + BigInt(match![2]!) * 10_000n).toString();

      expect(usd).toBe(integrityToolPrices[id].usd);
      expect(atomic).toBe(integrityToolPrices[id].atomic);
    }
  });
});
