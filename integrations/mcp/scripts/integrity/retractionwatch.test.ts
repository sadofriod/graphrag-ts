import { describe, expect, test } from 'bun:test';
import { normalizeRetractionDate, selectRetractionWatchRow } from './retractionwatch.ts';

describe('Retraction Watch row selection', () => {
  test('retraction takes precedence over a later correction', () => {
    const selected = selectRetractionWatchRow([
      { nature: ' Retraction ', date: '2020-01-02', reason: 'withdrawal' },
      { nature: 'Correction', date: '2022-01-02', reason: 'typo' },
    ]);
    expect(selected).toEqual({ is_retracted: true, date: '2020-01-02', reason: 'withdrawal', nature: 'Retraction' });
  });

  test('correction-only DOI remains a non-retraction notice', () => {
    expect(selectRetractionWatchRow([
      { nature: 'Correction', date: '2021-04-05', reason: 'data update' },
    ])).toEqual({ is_retracted: false, date: '2021-04-05', reason: 'data update', nature: 'Correction' });
  });

  test('normalizes Retraction Watch date formats and rejects empty or invalid dates', () => {
    expect(normalizeRetractionDate('2010/07/01')).toBe('2010-07-01');
    expect(normalizeRetractionDate('2010/7/1 0:00')).toBe('2010-07-01');
    expect(normalizeRetractionDate('1998/02/28')).toBe('1998-02-28');
    expect(normalizeRetractionDate('')).toBeNull();
    expect(normalizeRetractionDate('2010/02/30')).toBeNull();
    expect(normalizeRetractionDate('2/6/2010')).toBe('2010-02-06');
  });
});
