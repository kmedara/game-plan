/**
 * Recurrence window expansion coverage.
 */

import { describe, expect, it } from 'vitest';
import {
  assertScheduleWindow,
  expandOccurrenceStarts,
  occurrenceEndsAt,
} from './expand-occurrences.js';

describe('expandOccurrenceStarts', () => {
  it('returns a one-off start when it falls in the window', () => {
    const from = new Date('2026-09-01T00:00:00.000Z');
    const to = new Date('2026-09-30T23:59:59.999Z');
    const dates = expandOccurrenceStarts('2026-09-15T18:00:00.000Z', undefined, from, to);
    expect(dates.map((d) => d.toISOString())).toEqual(['2026-09-15T18:00:00.000Z']);
  });

  it('expands a weekly rule inside the window', () => {
    const from = new Date('2026-09-01T00:00:00.000Z');
    const to = new Date('2026-09-30T23:59:59.999Z');
    const dates = expandOccurrenceStarts(
      '2026-09-02T17:00:00.000Z',
      { frequency: 'WEEKLY', interval: 1, byWeekDay: ['WE'] },
      from,
      to,
    );
    expect(dates.map((d) => d.toISOString())).toEqual([
      '2026-09-02T17:00:00.000Z',
      '2026-09-09T17:00:00.000Z',
      '2026-09-16T17:00:00.000Z',
      '2026-09-23T17:00:00.000Z',
      '2026-09-30T17:00:00.000Z',
    ]);
  });

  it('honors count on the recurrence rule', () => {
    const from = new Date('2026-09-01T00:00:00.000Z');
    const to = new Date('2026-12-31T23:59:59.999Z');
    const dates = expandOccurrenceStarts(
      '2026-09-01T12:00:00.000Z',
      { frequency: 'DAILY', interval: 1, count: 3 },
      from,
      to,
    );
    expect(dates).toHaveLength(3);
  });
});

describe('assertScheduleWindow', () => {
  it('rejects an inverted or oversized window', () => {
    expect(() =>
      assertScheduleWindow('2026-10-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
    ).toThrow('invalid_window');
    expect(() =>
      assertScheduleWindow('2026-01-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'),
    ).toThrow('window_too_large');
  });
});

describe('occurrenceEndsAt', () => {
  it('keeps the series duration on each occurrence', () => {
    expect(
      occurrenceEndsAt(
        '2026-09-02T17:00:00.000Z',
        '2026-09-02T18:30:00.000Z',
        new Date('2026-09-09T17:00:00.000Z'),
      ),
    ).toBe('2026-09-09T18:30:00.000Z');
  });
});
