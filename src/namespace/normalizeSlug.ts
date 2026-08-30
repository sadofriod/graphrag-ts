const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

export const normalizeSlug = (raw: string): string | undefined => {
  const slug = raw.trim().toLowerCase();
  return SLUG_PATTERN.test(slug) ? slug : undefined;
};
