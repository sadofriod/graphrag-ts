import { readFile } from 'node:fs/promises';
import { dirname, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';

import { defineHarness } from './defineHarness';
import { getHarness, hasHarness, registerHarness } from './registry';
import type { HarnessDefinition, HarnessFileConfig, HarnessModelSpec } from './types';

const ENV_REF_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const describe = (error: unknown): string =>
  `${error instanceof Error ? error.name : 'Error'}: ${errorMessage(error)}`;

/**
 * Replaces `${VAR}` and `${VAR:-fallback}` references. Unset or empty variables
 * use the fallback; a reference without a fallback is recorded as missing and the
 * whole walk throws once with every missing name. Resolved values are never
 * included in errors or logs.
 */
export const resolveEnvRefs = (
  value: unknown,
  env: NodeJS.ProcessEnv = process.env,
): unknown => {
  const missing = new Set<string>();

  const interpolate = (input: string): string =>
    input.replace(ENV_REF_PATTERN, (_match: string, name: string, fallback: string | undefined) => {
      const raw = env[name];
      if (raw !== undefined && raw !== '') return raw;
      if (fallback !== undefined) return fallback;
      missing.add(name);
      return '';
    });

  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') return interpolate(node);
    if (Array.isArray(node)) return node.map((item) => walk(item));
    if (isPlainObject(node)) {
      const next: Record<string, unknown> = {};
      for (const [key, nested] of Object.entries(node)) {
        next[key] = walk(nested);
      }
      return next;
    }
    return node;
  };

  const resolved = walk(value);

  if (missing.size > 0) {
    const names = Array.from(missing).sort();
    throw new Error(
      `Missing environment variable${names.length === 1 ? '' : 's'} referenced by the harness config: ${names.join(', ')}. ` +
        'Set them in the environment or use the ${NAME:-fallback} form.',
    );
  }

  return resolved;
};

const asObject = (value: unknown, label: string): Record<string, unknown> => {
  if (!isPlainObject(value)) {
    throw new Error(`Harness config field '${label}' must be an object.`);
  }
  return value;
};

const asNonEmptyString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Harness config field '${label}' must be a non-empty string.`);
  }
  return value;
};

const parseOptional = <T>(
  record: Record<string, unknown>,
  key: string,
  label: string,
  parse: (value: unknown, label: string) => T,
): T | undefined => {
  const raw = record[key];
  return raw === undefined ? undefined : parse(raw, label);
};

const parseModelSpec = (value: unknown, label: string): HarnessModelSpec => {
  const record = asObject(value, label);
  const model = asNonEmptyString(record['model'], `${label}.model`);
  const apiKey = asNonEmptyString(record['apiKey'], `${label}.apiKey`);
  const provider = parseOptional(record, 'provider', `${label}.provider`, asNonEmptyString);
  const baseURL = parseOptional(record, 'baseURL', `${label}.baseURL`, asNonEmptyString);
  const options = parseOptional(record, 'options', `${label}.options`, asObject);

  return {
    model,
    apiKey,
    ...(provider === undefined ? {} : { provider }),
    ...(baseURL === undefined ? {} : { baseURL }),
    ...(options === undefined ? {} : { options }),
  };
};

const parseModels = (models: Record<string, unknown>): HarnessFileConfig['models'] => {
  const allowedSlots = new Set(['slice', 'judge', 'embedding']);
  for (const key of Object.keys(models)) {
    if (!allowedSlots.has(key)) {
      throw new Error(
        `Unknown model slot 'models.${key}'. Allowed slots: slice, judge, embedding.`,
      );
    }
  }

  const slice = parseOptional(models, 'slice', 'models.slice', parseModelSpec);
  const judge = parseOptional(models, 'judge', 'models.judge', parseModelSpec);
  const embedding = parseOptional(models, 'embedding', 'models.embedding', parseModelSpec);

  return {
    ...(slice === undefined ? {} : { slice }),
    ...(judge === undefined ? {} : { judge }),
    ...(embedding === undefined ? {} : { embedding }),
  };
};

/**
 * Validates a (already env-resolved) harness config. Unknown top-level keys are
 * ignored so configs can carry extra metadata. The whole `database` block is
 * optional because the MCP service connects with `DATABASE_URL` and injects its
 * Prisma client; `database.url` is likewise optional for injected clients.
 */
export const validateHarnessConfig = (config: unknown): HarnessFileConfig => {
  const root = asObject(config, '(root)');
  const harness = asNonEmptyString(root['harness'], 'harness');
  const rawDatabase = root['database'];
  const database = rawDatabase === undefined ? {} : asObject(rawDatabase, 'database');
  const databaseUrl = parseOptional(database, 'url', 'database.url', asNonEmptyString);
  const models = parseModels(asObject(root['models'], 'models'));
  const retrievalDefaults = parseOptional(root, 'retrievalDefaults', 'retrievalDefaults', asObject);
  const buildDefaults = parseOptional(root, 'buildDefaults', 'buildDefaults', asObject);

  return {
    harness,
    database: databaseUrl === undefined ? {} : { url: databaseUrl },
    models,
    ...(retrievalDefaults === undefined ? {} : { retrievalDefaults }),
    ...(buildDefaults === undefined ? {} : { buildDefaults }),
  };
};

/**
 * Reads a harness JSON file, interpolates `${VAR}` references and validates it.
 * Error messages name the file path but never echo resolved (secret) values.
 */
export const loadHarnessConfig = async (
  path: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<HarnessFileConfig> => {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    throw new Error(`Failed to read harness config '${path}' (${describe(error)}).`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse harness config '${path}' as JSON (${describe(error)}).`);
  }

  return validateHarnessConfig(resolveEnvRefs(parsed, env));
};

const isPathLike = (id: string): boolean => id.startsWith('.') || id.startsWith('/');

const pluginCandidate = (module: Record<string, unknown>): unknown =>
  module['default'] ?? module['harness'];

/**
 * Resolves a harness id: built-in/registered ids come from the registry, while
 * ids starting with `.` or `/` are plugin modules resolved relative to the
 * config file and registered on first use.
 */
export const resolveHarnessDefinition = async (
  id: string,
  configPath?: string,
): Promise<HarnessDefinition> => {
  const key = id.trim();

  if (hasHarness(key)) return getHarness(key);

  if (isPathLike(key)) {
    if (!configPath) {
      throw new Error(
        `Cannot resolve harness plugin '${key}' without a config path. Pass the harness config file path so relative plugin ids can be resolved.`,
      );
    }

    const absolutePath = resolvePath(dirname(resolvePath(configPath)), key);
    let module: Record<string, unknown>;
    try {
      module = (await import(pathToFileURL(absolutePath).href)) as Record<string, unknown>;
    } catch (error) {
      throw new Error(`Failed to load harness plugin '${absolutePath}' (${describe(error)}).`);
    }

    const candidate = pluginCandidate(module);
    if (candidate === undefined) {
      throw new Error(
        `Harness plugin '${absolutePath}' must export a harness definition as its default export or as a named 'harness' export.`,
      );
    }

    const definition = defineHarness(candidate as HarnessDefinition);
    return registerHarness(definition);
  }

  return getHarness(key);
};

/**
 * Log-safe rendering of a secret: first 3 and last 4 characters when long
 * enough to be meaningfully maskable, otherwise `***`.
 */
export const maskSecret = (value: string): string =>
  value.length > 12 ? `${value.slice(0, 3)}\u2026${value.slice(-4)}` : '***';
