/**
 * Recurrence window expansion coverage.
 */

import { describe, expect, it } from 'vitest';
import {
  assertScheduleWindow,
  buildRRule,
  expandOccurrenceStarts,
  occurrenceEndsAt,
  parseInstant,
} from './expand-occurrences.js';

describe('expandOccurrenceStarts', () => {
  it('returns a one-off start when it falls in the window', () => {
    const from = new Date('2026-09-01T00:00:00.000Z');
    const to = new Date('2026-09-30T23:59:59.999Z');
    const dates = expandOccurrenceStarts('2026-09-15T18:00:00.000Z', undefined, from, to, 'UTC');
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
      'UTC',
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
      'UTC',
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

  it('returns undefined when the series has no end and rejects invalid ends', () => {
    expect(
      occurrenceEndsAt(
        '2026-09-02T17:00:00.000Z',
        undefined,
        new Date('2026-09-09T17:00:00.000Z'),
      ),
    ).toBeUndefined();
    expect(() =>
      occurrenceEndsAt(
        '2026-09-02T17:00:00.000Z',
        '2026-09-02T16:00:00.000Z',
        new Date('2026-09-09T17:00:00.000Z'),
      ),
    ).toThrow('invalid_ends_at');
  });
});

describe('parseInstant and buildRRule', () => {
  it('defaults recurrence interval to 1 when omitted', () => {
    const rule = buildRRule(new Date('2026-09-01T12:00:00.000Z'), { frequency: 'DAILY' });
    expect(rule.options.interval).toBe(1);
  });

  it('throws for invalid instants and weekday codes', () => {
    expect(() => parseInstant('not-a-date', 'starts_at')).toThrow('invalid_starts_at');
    expect(() =>
      buildRRule(new Date('2026-09-01T12:00:00.000Z'), {
        frequency: 'WEEKLY',
        interval: 1,
        byWeekDay: ['XX'],
      }),
    ).toThrow('invalid_by_week_day');
  });

  it('caps expanded occurrences per event', () => {
    const from = new Date('2026-01-01T00:00:00.000Z');
    const to = new Date('2028-12-31T23:59:59.999Z');
    const dates = expandOccurrenceStarts(
      '2026-01-01T08:00:00.000Z',
      { frequency: 'DAILY', interval: 1 },
      from,
      to,
      'UTC',
    );
    expect(dates).toHaveLength(366);
  });

  it('returns no dates when a one-off falls outside the window', () => {
    const from = new Date('2026-10-01T00:00:00.000Z');
    const to = new Date('2026-10-31T23:59:59.999Z');
    expect(
      expandOccurrenceStarts('2026-09-01T12:00:00.000Z', undefined, from, to, 'UTC'),
    ).toEqual([]);
  });
});

describe('expandOccurrenceStarts on the team wall clock', () => {
  const pacific = 'America/Los_Angeles';
  const local = (date: Date): string =>
    date.toLocaleString('en-US', { timeZone: pacific, weekday: 'short', hour: 'numeric', minute: '2-digit' });

  it('keeps a Tuesday-evening practice on Tuesdays when it is Wednesday in UTC', () => {
    // Tuesday 2026-10-20 at 7:00 pm Pacific is 02:00 UTC on Wednesday.
    const dates = expandOccurrenceStarts(
      '2026-10-21T02:00:00.000Z',
      { frequency: 'WEEKLY', byWeekDay: ['TU'] },
      new Date('2026-10-19T00:00:00.000Z'),
      new Date('2026-10-31T00:00:00.000Z'),
      pacific,
    );
    expect(dates.map((date) => date.toISOString())).toEqual(['2026-10-21T02:00:00.000Z', '2026-10-28T02:00:00.000Z']);
    expect(dates.map(local)).toEqual(['Tue 7:00 PM', 'Tue 7:00 PM']);
  });

  it('stays at 7 pm local across the November daylight-saving change', () => {
    const dates = expandOccurrenceStarts(
      '2026-10-21T02:00:00.000Z',
      { frequency: 'WEEKLY' },
      new Date('2026-10-19T00:00:00.000Z'),
      new Date('2026-11-12T00:00:00.000Z'),
      pacific,
    );
    expect(dates.map(local)).toEqual(['Tue 7:00 PM', 'Tue 7:00 PM', 'Tue 7:00 PM', 'Tue 7:00 PM']);
    // After clocks fall back the UTC instant moves an hour later.
    expect(dates[2]?.toISOString()).toBe('2026-11-04T03:00:00.000Z');
  });

  it('stops at an until instant on the local calendar', () => {
    const dates = expandOccurrenceStarts(
      '2026-10-21T02:00:00.000Z',
      { frequency: 'WEEKLY', until: '2026-11-04T03:00:00.000Z' },
      new Date('2026-10-19T00:00:00.000Z'),
      new Date('2026-12-31T00:00:00.000Z'),
      pacific,
    );
    expect(dates).toHaveLength(3);
  });
});
