import type { RwRow } from './sources.ts';

export type SelectedRwNotice = { is_retracted: boolean; date: string | null; reason: string | null; nature: string | null };

const dateParts = (value: string): number[] | null => {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? [Number(match[3]), Number(match[1]), Number(match[2])] : iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : null;
};

const dateValue = (raw: string | undefined): number => {
  if (!raw?.trim()) return Number.NEGATIVE_INFINITY;
  const parts = dateParts(raw.trim());
  if (!parts) return Number.NEGATIVE_INFINITY;
  const [year, month, day] = parts;
  const timestamp = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1);
  const parsed = new Date(timestamp);
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === (month ?? 1) - 1 && parsed.getUTCDate() === day ? timestamp : Number.NEGATIVE_INFINITY;
};

export const normalizeRetractionDate = (raw: string | undefined): string | null => {
  const timestamp = dateValue(raw);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : null;
};

const isRetraction = (row: RwRow): boolean => {
  const nature = row.RetractionNature?.trim() ?? '';
  return !/reinstatement/i.test(nature) && /retraction/i.test(nature);
};

const latestRow = (rows: readonly RwRow[]): RwRow | undefined =>
  [...rows].sort((left, right) => dateValue(right.RetractionDate) - dateValue(left.RetractionDate))[0];

export const selectRetractionWatchRow = (rows: readonly RwRow[]): SelectedRwNotice | undefined => {
  if (!rows.length) return undefined;
  const selected = latestRow(rows.filter(isRetraction)) ?? latestRow(rows);
  if (!selected) return undefined;
  return {
    is_retracted: rows.some(isRetraction),
    date: normalizeRetractionDate(selected.RetractionDate),
    reason: selected.Reason?.trim() || null,
    nature: selected.RetractionNature?.trim() || null,
  };
};
