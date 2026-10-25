import { describe, expect, test } from 'bun:test';
import { normalizeRetractionDate, selectRetractionWatchRow } from './retractionwatch.ts';

describe('Retraction Watch row selection', () => {
  test('retraction takes precedence over a later correction', () => {
    const selected = selectRetractionWatchRow([
      { RetractionNature: ' Retraction ', RetractionDate: '1/2/2020', Reason: 'withdrawal' },
      { RetractionNature: 'Correction', RetractionDate: '1/2/2022', Reason: 'typo' },
    ]);
    expect(selected).toEqual({ is_retracted: true, date: '2020-01-02', reason: 'withdrawal', nature: 'Retraction' });
  });

  test('correction-only DOI remains a non-retraction notice', () => {
    expect(selectRetractionWatchRow([
      { RetractionNature: 'Correction', RetractionDate: '2021-04-05', Reason: 'data update' },
    ])).toEqual({ is_retracted: false, date: '2021-04-05', reason: 'data update', nature: 'Correction' });
  });

  test('normalizes M/D/YYYY dates', () => {
    expect(normalizeRetractionDate('2/6/2010')).toBe('2010-02-06');
  });
});
