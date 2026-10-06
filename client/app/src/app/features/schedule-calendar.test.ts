/**
 * Month-grid placement in a team time zone.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  buildMonthGrid,
  dayKeyInZone,
  rruleWeekDay,
  shiftCalendarMonth,
  wallTimeToIso,
} from './schedule-calendar';

describe('schedule calendar', () => {
  it('places October 2026 on a Sunday-first grid in New York', () => {
    const cells = buildMonthGrid(2026, 10, 'America/New_York');
    expect(cells[0]?.key).toBe('2026-09-27');
    expect(cells.find((cell) => cell.key === '2026-10-01')).toMatchObject({
      day: 1,
      inMonth: true,
    });
    expect(cells.at(-1)?.key).toBe('2026-10-31');
    expect(cells.length % 7).toBe(0);
  });

  it('pads March 2026 with trailing days from April', () => {
    const cells = buildMonthGrid(2026, 3, 'America/New_York');
    expect(cells.some((cell) => cell.key === '2026-04-01' && !cell.inMonth)).toBe(true);
    expect(cells.length % 7).toBe(0);
  });

  it('wraps lead and trail months across the year boundary', () => {
    const january = buildMonthGrid(2026, 1, 'America/New_York');
    expect(january.some((cell) => cell.key.startsWith('2025-12-'))).toBe(true);
    const december = buildMonthGrid(2026, 12, 'America/New_York');
    expect(december.some((cell) => cell.key.startsWith('2027-01-'))).toBe(true);
  });

  it('stores 6:00pm Eastern as 22:00 UTC during daylight time', () => {
    expect(wallTimeToIso('America/New_York', '2026-10-05', '18:00')).toBe(
      '2026-10-05T22:00:00.000Z',
    );
    expect(dayKeyInZone(new Date('2026-10-05T22:00:00.000Z'), 'America/New_York')).toBe(
      '2026-10-05',
    );
  });

  it('maps a civil date to an iCalendar weekday', () => {
    expect(rruleWeekDay('2026-10-05')).toBe('MO');
    expect(rruleWeekDay('2026-10-01')).toBe('TH');
  });

  it('steps across the year boundary', () => {
    expect(shiftCalendarMonth({ year: 2026, month: 1 }, -1)).toEqual({
      year: 2025,
      month: 12,
    });
    expect(shiftCalendarMonth({ year: 2026, month: 12 }, 1)).toEqual({
      year: 2027,
      month: 1,
    });
  });

  it('normalizes hour 24 and missing Intl parts when reading zoned times', () => {
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts').mockReturnValue([
      { type: 'year', value: '2026' },
      { type: 'month', value: '10' },
      { type: 'day', value: '05' },
      { type: 'hour', value: '24' },
      { type: 'minute', value: '00' },
    ] as Intl.DateTimeFormatPart[]);
    expect(wallTimeToIso('America/New_York', '2026-10-05', '00:00')).toMatch(/T/);
    spy.mockReturnValue([
      { type: 'literal', value: 'x' },
    ] as Intl.DateTimeFormatPart[]);
    expect(wallTimeToIso('UTC', '2026-01-01', '00:00')).toMatch(/T/);
    spy.mockRestore();
  });
});
