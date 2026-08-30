import { normalizeSlug } from './normalizeSlug';

export const DEFAULT_NAMESPACE = 'default-namespace';
export const DEFAULT_NAMESPACE_ENV = 'RAG_DEFAULT_NAMESPACE';

export const resolveNamespace = (header?: string | null): string => {
  const fromHeader = header === undefined || header === null ? undefined : normalizeSlug(header);
  if (fromHeader !== undefined) {
    return fromHeader;
  }

  const envValue = Bun.env[DEFAULT_NAMESPACE_ENV];
  const fromEnv = envValue === undefined ? undefined : normalizeSlug(envValue);
  return fromEnv ?? DEFAULT_NAMESPACE;
};
