/**
 * Conversions between UTC instants and wall-clock time in a team's time zone.
 *
 * Events repeat by the clock on the team's wall: "Tuesdays at 7 pm" stays at
 * 7 pm across a daylight-saving change and stays on Tuesday even when that is
 * Wednesday in UTC. Code that repeats or compares local times converts here.
 *
 * A "wall-clock date" is a `Date` whose UTC fields hold the local fields, so
 * plain UTC arithmetic (and `rrule`) can run on local time.
 */

/**
 * Offset of `timeZone` from UTC at `instant`, in milliseconds.
 *
 * @param instant - The UTC instant.
 * @param timeZone - An IANA time zone.
 * @returns Wall-clock time minus UTC time.
 */
export const zoneOffsetMs = (instant: Date, timeZone: string): number => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour'),
    value('minute'),
    value('second'),
  );
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
};

/**
 * Converts a wall-clock time in `timeZone` to a UTC instant.
 *
 * A time skipped by a spring-forward change resolves to the instant just after
 * the gap; an hour repeated by a fall-back change resolves to its first pass.
 *
 * @param year - Calendar year.
 * @param month - Calendar month, 1-12.
 * @param day - Calendar day.
 * @param hour - Hour in 0-23.
 * @param minute - Minute.
 * @param timeZone - An IANA time zone.
 * @param second - Second; defaults to 0.
 * @returns The UTC instant.
 */
export const zonedWallToUtc = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
  second = 0,
): Date => {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const corrected = utcGuess - zoneOffsetMs(new Date(utcGuess), timeZone);
  return new Date(utcGuess - zoneOffsetMs(new Date(corrected), timeZone));
};

/**
 * Calendar date of an instant in a time zone.
 *
 * @param instant - The UTC instant.
 * @param timeZone - An IANA time zone.
 * @returns Year, month (1-12), and day.
 */
export const zonedDate = (
  instant: Date,
  timeZone: string,
): { year: number; month: number; day: number } => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  return { year: value('year'), month: value('month'), day: value('day') };
};

/**
 * The local time of an instant, as a wall-clock date.
 *
 * @param instant - The UTC instant.
 * @param timeZone - An IANA time zone.
 * @returns A `Date` whose UTC fields read as the local time.
 */
export const toWallClock = (instant: Date, timeZone: string): Date =>
  new Date(Math.floor(instant.getTime() / 1000) * 1000 + zoneOffsetMs(instant, timeZone));

/**
 * The UTC instant for a wall-clock date.
 *
 * @param wall - A `Date` whose UTC fields read as the local time.
 * @param timeZone - An IANA time zone.
 * @returns The real instant.
 */
export const fromWallClock = (wall: Date, timeZone: string): Date =>
  zonedWallToUtc(
    wall.getUTCFullYear(),
    wall.getUTCMonth() + 1,
    wall.getUTCDate(),
    wall.getUTCHours(),
    wall.getUTCMinutes(),
    timeZone,
    wall.getUTCSeconds(),
  );
