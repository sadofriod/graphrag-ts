import { deepseekHarness } from './deepseek';
import { defineHarness } from './defineHarness';
import type { HarnessDefinition } from './types';

const harnesses = new Map<string, HarnessDefinition>();

const normalizeKey = (id: string): string => id.trim();

/**
 * Registers (or replaces) a harness. Definitions are re-validated and frozen on
 * the way in, so the registry only ever holds immutable definitions.
 */
export const registerHarness = (definition: HarnessDefinition): HarnessDefinition => {
  const normalized = defineHarness(definition);
  harnesses.set(normalized.id, normalized);
  return normalized;
};

export const hasHarness = (id: string): boolean => harnesses.has(normalizeKey(id));

export const getHarness = (id: string): HarnessDefinition => {
  const harness = harnesses.get(normalizeKey(id));
  if (!harness) {
    throw new Error(
      `Unknown harness '${id}'. Available harnesses: ${listHarnesses().join(', ')}`,
    );
  }
  return harness;
};

export const listHarnesses = (): string[] => Array.from(harnesses.keys()).sort();

export const resetHarnesses = (): void => {
  harnesses.clear();
  harnesses.set(deepseekHarness.id, deepseekHarness);
};

resetHarnesses();
