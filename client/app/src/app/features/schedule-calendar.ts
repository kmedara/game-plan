/**
 * Month-grid helpers for the schedule screen.
 *
 * Day keys are `YYYY-MM-DD` wall dates in the team's time zone. Instants sent
 * to the API stay UTC ISO strings.
 */

/** Sunday-first labels for the month grid. */
export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * iCalendar `BYDAY` codes, Sunday first.
 *
 * These are the weekday tokens `rrule` expects. The order matches {@link WEEKDAY_LABELS}.
 */
export const RRULE_WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

/**
 * Weekday token for a civil date, independent of the clock time.
 *
 * `YYYY-MM-DD` is the wall date the user picked. Weekly recurrence uses this
 * `BYDAY` value so the series stays on that weekday.
 *
 * @param dayKey - A `YYYY-MM-DD` wall date.
 * @returns An iCalendar weekday code.
 */
export const rruleWeekDay = (dayKey: string): (typeof RRULE_WEEKDAYS)[number] => {
  const [year, month, day] = dayKey.split('-').map(Number) as [number, number, number];
  // getUTCDay is always 0–6 for a valid civil date.
  return RRULE_WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]!;
};

/** One cell in a month grid, including days that belong to the adjacent months. */
export type CalendarCell = {
  key: string;
  day: number;
  inMonth: boolean;
};

/** Visible month, with `month` in the range 1–12. */
export type CalendarMonth = {
  year: number;
  month: number;
};

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

/**
 * Pads a date or time part to two digits.
 *
 * @param value - The numeric part.
 * @returns A two-digit string.
 */
const pad = (value: number): string => String(value).padStart(2, '0');

/**
 * Reads calendar parts of an instant in a time zone.
 *
 * @param instant - The UTC instant.
 * @param timeZone - An IANA time zone.
 * @returns The wall-clock parts in that zone.
 */
const zonedParts = (instant: Date, timeZone: string): ZonedParts => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  const hour = read('hour');
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: hour === 24 ? 0 : hour,
    minute: read('minute'),
  };
};

/**
 * Converts a team-local date and time to a UTC ISO instant.
 *
 * @param timeZone - An IANA time zone.
 * @param dayKey - A `YYYY-MM-DD` wall date.
 * @param time - An `HH:mm` wall time.
 * @returns The UTC ISO string.
 */
export const wallTimeToIso = (timeZone: string, dayKey: string, time: string): string => {
  const [year, month, day] = dayKey.split('-').map(Number) as [number, number, number];
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const intended = utc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = zonedParts(new Date(utc), timeZone);
    const shown = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    const delta = shown - intended;
    if (delta === 0) break;
    utc -= delta;
  }
  return new Date(utc).toISOString();
};

/**
 * Returns the `YYYY-MM-DD` wall date of an instant in a time zone.
 *
 * @param instant - The UTC instant.
 * @param timeZone - An IANA time zone.
 * @returns The wall date key.
 */
export const dayKeyInZone = (instant: Date, timeZone: string): string => {
  const parts = zonedParts(instant, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
};

/**
 * Returns how many days are in a calendar month.
 *
 * @param year - The full year.
 * @param month - The month, from 1 to 12.
 * @returns The day count.
 */
export const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * Shifts a year/month by a number of months.
 *
 * @param current - The visible month.
 * @param delta - Months to add. Negative moves backward.
 * @returns The resulting month.
 */
export const shiftCalendarMonth = (current: CalendarMonth, delta: number): CalendarMonth => {
  const index = current.year * 12 + (current.month - 1) + delta;
  const year = Math.floor(index / 12);
  return { year, month: index - year * 12 + 1 };
};

/**
 * Builds a Sunday-first month grid, padded with the neighboring months.
 *
 * @param year - The full year.
 * @param month - The month, from 1 to 12.
 * @param timeZone - An IANA time zone used to place the first weekday.
 * @returns Six or fewer weeks of cells. The length is always a multiple of 7.
 */
export const buildMonthGrid = (
  year: number,
  month: number,
  timeZone: string,
): CalendarCell[] => {
  const firstKey = `${year}-${pad(month)}-01`;
  const noon = new Date(wallTimeToIso(timeZone, firstKey, '12:00'));
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(noon);
  const lead = WEEKDAY_LABELS.indexOf(weekday as (typeof WEEKDAY_LABELS)[number]);
  const count = daysInMonth(year, month);
  const cells: CalendarCell[] = [];

  const previous = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  const previousCount = daysInMonth(previous.year, previous.month);
  for (let index = 0; index < lead; index += 1) {
    const day = previousCount - lead + 1 + index;
    cells.push({
      key: `${previous.year}-${pad(previous.month)}-${pad(day)}`,
      day,
      inMonth: false,
    });
  }

  for (let day = 1; day <= count; day += 1) {
    cells.push({
      key: `${year}-${pad(month)}-${pad(day)}`,
      day,
      inMonth: true,
    });
  }

  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  let nextDay = 1;
  while (cells.length % 7 !== 0) {
    cells.push({
      key: `${next.year}-${pad(next.month)}-${pad(nextDay)}`,
      day: nextDay,
      inMonth: false,
    });
    nextDay += 1;
  }
  return cells;
};

/**
 * Formats a visible month for the calendar heading.
 *
 * @param month - The visible month.
 * @param timeZone - An IANA time zone.
 * @returns A label such as "October 2026".
 */
export const monthTitle = (month: CalendarMonth, timeZone: string): string =>
  new Intl.DateTimeFormat('en-US', { timeZone, month: 'long', year: 'numeric' }).format(
    new Date(wallTimeToIso(timeZone, `${month.year}-${pad(month.month)}-15`, '12:00')),
  );

/**
 * Formats a selected day for the detail heading.
 *
 * @param dayKey - A `YYYY-MM-DD` wall date.
 * @param timeZone - An IANA time zone.
 * @returns A label such as "Monday, October 5".
 */
export const dayTitle = (dayKey: string, timeZone: string): string =>
  new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date(wallTimeToIso(timeZone, dayKey, '12:00')));

/**
 * Formats an instant as a clock time in the team zone.
 *
 * @param iso - A UTC ISO instant.
 * @param timeZone - An IANA time zone.
 * @returns A short clock time.
 */
export const clockLabel = (iso: string, timeZone: string): string =>
  new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(
    new Date(iso),
  );
