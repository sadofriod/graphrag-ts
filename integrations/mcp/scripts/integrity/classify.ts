export type ContextClass =
  | 'acknowledges_retraction'
  | 'critical'
  | 'supporting_evidence'
  | 'neutral'
  | 'unknown';

const groups: readonly [ContextClass, readonly string[]][] = [
  ['acknowledges_retraction', ['retract', 'withdrawn', 'misconduct', 'fraud', 'fabricat', 'cannot be reproduced', 'could not be reproduced']],
  ['critical', ['flawed', 'problematic', 'invalid', 'unreliable', 'criticis', 'criticiz', 'questionable']],
  ['supporting_evidence', ['confirm', 'consistent with', 'in line with', 'replicat', 'support', 'corroborat', 'agree']],
];

export const classifyContext = (snippet?: string | null): ContextClass => {
  if (!snippet?.trim()) return 'unknown';
  const text = snippet.toLowerCase();
  for (const [classification, keywords] of groups) {
    if (keywords.some((keyword) => text.includes(keyword))) return classification;
  }
  return 'neutral';
};

export const normalizeDoi = (doi?: string | null): string | null => {
  if (!doi?.trim()) return null;
  const normalized = doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi\s*:\s*/i, '').trim().replace(/[.,;]+$/, '').toLowerCase();
  return normalized || null;
};

export const normalizeOpenAlexId = (id?: string | null): string | null => {
  if (!id?.trim()) return null;
  const value = id.trim().replace(/\/$/, '');
  const shortId = value.split('/').at(-1)?.trim();
  if (!shortId) return null;
  return shortId.toUpperCase();
};
