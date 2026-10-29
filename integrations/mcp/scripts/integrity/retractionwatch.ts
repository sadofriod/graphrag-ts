export type RwNotice = { date: string | null; reason: string | null; nature: string | null };

export type SelectedRwNotice = { is_retracted: boolean; date: string | null; reason: string | null; nature: string | null };

const dateParts = (value: string): number[] | null => {
  const slashYmd = value.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return slashYmd ? [Number(slashYmd[1]), Number(slashYmd[2]), Number(slashYmd[3])]
    : match ? [Number(match[3]), Number(match[1]), Number(match[2])]
      : iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : null;
};

const TIME_SUFFIX = /^(.*?)\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/u;

const timeIsValid = (timed: RegExpMatchArray): boolean =>
  Number(timed[2]) <= 23 && Number(timed[3]) <= 59 && Number(timed[4] ?? 0) <= 59;

/** Drops an `HH:MM(:SS)` suffix; null when that time is impossible. */
const stripTime = (value: string): string | null => {
  const timed = value.match(TIME_SUFFIX);
  if (!timed) return value;
  return timeIsValid(timed) ? timed[1] ?? '' : null;
};

const dateValue = (raw: string | undefined): number => {
  if (!raw?.trim()) return Number.NEGATIVE_INFINITY;
  const dateOnly = stripTime(raw.trim());
  const parts = dateOnly === null ? null : dateParts(dateOnly);
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

const isRetraction = (row: RwNotice): boolean => {
  const nature = row.nature?.trim() ?? '';
  return !/reinstatement/i.test(nature) && /retraction/i.test(nature);
};

const latestRow = (rows: readonly RwNotice[]): RwNotice | undefined =>
  [...rows].sort((left, right) => dateValue(right.date ?? undefined) - dateValue(left.date ?? undefined))[0];

export const selectRetractionWatchRow = (rows: readonly RwNotice[]): SelectedRwNotice | undefined => {
  if (!rows.length) return undefined;
  const selected = latestRow(rows.filter(isRetraction)) ?? latestRow(rows);
  if (!selected) return undefined;
  return {
    is_retracted: rows.some(isRetraction),
    date: selected.date,
    reason: selected.reason?.trim() || null,
    nature: selected.nature?.trim() || null,
  };
};
