/**
 * Start clock plus an optional end, as minutes the add-event form can edit.
 */

import { clockFromMinutes, shiftDayKey, wallTimeToIso } from './schedule-calendar';

/** Preset lengths offered as chips, in minutes. */
export const DURATION_PRESETS = [60, 90, 120] as const;

/** Default start: 6:00pm. */
export const DEFAULT_START_MINUTES = 18 * 60;

/** How the end of an event is chosen. */
export type EndChoice =
  | { kind: 'none' }
  | { kind: 'minutes'; minutes: (typeof DURATION_PRESETS)[number] }
  | { kind: 'clock'; minutes: number };

/** Instants produced from a wall day and the form's clocks. */
export type EventWindow = {
  startsAt: string;
  endsAt?: string;
  nextDay: boolean;
  durationMinutes?: number;
};

/**
 * Builds the UTC window for a wall day, start clock, and end choice.
 *
 * A custom end clock earlier than the start lands on the next civil day.
 * A preset duration that passes midnight does the same.
 *
 * @param timeZone - Team IANA time zone.
 * @param dayKey - Selected `YYYY-MM-DD` wall date.
 * @param startMinutes - Start minutes from midnight.
 * @param end - End choice.
 * @returns Start, optional end, and whether the end is the next day.
 */
export const eventWindow = (
  timeZone: string,
  dayKey: string,
  startMinutes: number,
  end: EndChoice,
): EventWindow => {
  const startsAt = wallTimeToIso(timeZone, dayKey, clockFromMinutes(startMinutes));
  if (end.kind === 'none') return { startsAt, nextDay: false };
  const total = end.kind === 'minutes' ? startMinutes + end.minutes : end.minutes;
  const nextDay = end.kind === 'minutes' ? total >= 1440 : total < startMinutes;
  const endsAt = wallTimeToIso(
    timeZone,
    nextDay ? shiftDayKey(dayKey, 1) : dayKey,
    clockFromMinutes(total),
  );
  const durationMinutes = Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60000);
  return { startsAt, endsAt, nextDay, durationMinutes };
};
