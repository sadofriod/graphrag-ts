import type { HarnessDefinition } from './types';

const HARNESS_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

const requireNonEmpty = (value: unknown, label: string, harnessId: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Harness '${harnessId}' requires a non-empty ${label}.`);
  }
  return value.trim();
};

const optionalNonEmpty = (
  value: unknown,
  label: string,
  harnessId: string,
): string | undefined => (value === undefined ? undefined : requireNonEmpty(value, label, harnessId));

const freezeAdapters = <T>(adapters: Record<string, T> | undefined): Record<string, T> | undefined =>
  adapters === undefined ? undefined : Object.freeze({ ...adapters });

/** Drops `undefined` fields so the frozen object matches `HarnessDefinition` under exactOptionalPropertyTypes. */
const compact = (record: Record<string, unknown>): Record<string, unknown> => {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) next[key] = value;
  }
  return next;
};

/**
 * Validates a harness definition and returns a frozen copy.
 * Freezing keeps registrations immutable so a registered harness cannot be
 * mutated behind the registry's back.
 */
export const defineHarness = (definition: HarnessDefinition): HarnessDefinition => {
  if (!definition || typeof definition !== 'object') {
    throw new Error('defineHarness requires a harness definition object.');
  }

  const rawId: unknown = definition.id;
  if (typeof rawId !== 'string' || !HARNESS_ID_PATTERN.test(rawId)) {
    throw new Error(
      `Invalid harness id '${String(rawId)}'. Harness ids must match ${HARNESS_ID_PATTERN.source} (lowercase letters, digits and dashes).`,
    );
  }

  const id = rawId;
  const normalized = compact({
    id,
    description: requireNonEmpty(definition.description, 'description', id),
    chatProvider: requireNonEmpty(definition.chatProvider, 'chatProvider', id),
    embeddingProvider: optionalNonEmpty(definition.embeddingProvider, 'embeddingProvider', id),
    defaultChatBaseURL: optionalNonEmpty(definition.defaultChatBaseURL, 'defaultChatBaseURL', id),
    defaultEmbeddingBaseURL: optionalNonEmpty(
      definition.defaultEmbeddingBaseURL,
      'defaultEmbeddingBaseURL',
      id,
    ),
    chatAdapters: freezeAdapters(definition.chatAdapters),
    embeddingAdapters: freezeAdapters(definition.embeddingAdapters),
    requiresEmbedding: definition.requiresEmbedding,
  });

  return Object.freeze(normalized) as unknown as HarnessDefinition;
};
