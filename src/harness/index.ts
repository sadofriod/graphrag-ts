export { defineHarness } from './defineHarness';
export { deepseekHarness } from './deepseek';
export { getHarness, listHarnesses, registerHarness, resetHarnesses } from './registry';
export {
  loadHarnessConfig,
  maskSecret,
  resolveEnvRefs,
  resolveHarnessDefinition,
  validateHarnessConfig,
} from './config';
export { applyHarness, maskDatabaseUrl, planHarness } from './apply';

export type { AppliedHarness, ApplyHarnessOptions, HarnessPlan } from './apply';
export type {
  AppliedHarnessSummary,
  HarnessDefinition,
  HarnessFileConfig,
  HarnessModelSpec,
} from './types';
