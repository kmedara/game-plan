/**
 * Month-grid placement in a team time zone.
 */

import { describe, expect, it } from 'vitest';
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
});
