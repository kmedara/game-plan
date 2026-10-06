/**
 * Expand a stored recurrence rule into occurrence instants for a visible window.
 *
 * Occurrence rows are not stored. The schedule Lambda loads event definitions and
 * expands them in memory, same idea as Balance's expand-occurrences helper.
 */

import rrule from 'rrule';
import type { Frequency, Weekday } from 'rrule';
import type { RecurrenceRule } from '@gameplan/types';

/** rrule's CJS build exposes constructors on the default export under Node ESM. */
const { RRule } = rrule;

/** Max length of a client-requested schedule window (about three months). */
export const MAX_SCHEDULE_WINDOW_MS = 92 * 24 * 60 * 60 * 1000;

/** Safety cap when expanding one event into a window. */
export const MAX_OCCURRENCES_PER_EVENT = 366;

const FREQ_MAP: Record<RecurrenceRule['frequency'], Frequency> = {
  DAILY: RRule.DAILY,
  WEEKLY: RRule.WEEKLY,
  MONTHLY: RRule.MONTHLY,
  YEARLY: RRule.YEARLY,
};

const WEEKDAY_MAP: Record<string, Weekday> = {
  MO: RRule.MO,
  TU: RRule.TU,
  WE: RRule.WE,
  TH: RRule.TH,
  FR: RRule.FR,
  SA: RRule.SA,
  SU: RRule.SU,
};

/**
 * Parses an ISO-8601 instant, or throws when the value is not a valid date.
 *
 * @param value - An ISO date-time string.
 * @param label - A stable error suffix for the caller.
 * @returns The parsed `Date`.
 */
export const parseInstant = (value: string, label: string): Date => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid_${label}`);
  return date;
};

/**
 * Ensures a schedule window is ordered and within the allowed span.
 *
 * @param fromIso - Inclusive window start (UTC ISO).
 * @param toIso - Inclusive window end (UTC ISO).
 * @returns Parsed window bounds.
 */
export const assertScheduleWindow = (
  fromIso: string,
  toIso: string,
): { from: Date; to: Date } => {
  const from = parseInstant(fromIso, 'from');
  const to = parseInstant(toIso, 'to');
  if (from.getTime() > to.getTime()) throw new Error('invalid_window');
  if (to.getTime() - from.getTime() > MAX_SCHEDULE_WINDOW_MS) {
    throw new Error('window_too_large');
  }
  return { from, to };
};

/**
 * Builds an `RRule` from the stored structured recurrence and series start.
 *
 * @param startsAt - Series `DTSTART` in UTC.
 * @param recurrence - The stored recurrence rule.
 * @returns An `RRule` ready for `between`.
 */
export const buildRRule = (
  startsAt: Date,
  recurrence: RecurrenceRule,
): InstanceType<typeof RRule> => {
  const byweekday =
    recurrence.byWeekDay === undefined
      ? undefined
      : recurrence.byWeekDay.map((code) => {
          const day = WEEKDAY_MAP[code.toUpperCase()];
          if (day === undefined) throw new Error('invalid_by_week_day');
          return day;
        });

  return new RRule({
    freq: FREQ_MAP[recurrence.frequency],
    interval: recurrence.interval ?? 1,
    dtstart: startsAt,
    ...(recurrence.until !== undefined
      ? { until: parseInstant(recurrence.until, 'until') }
      : {}),
    ...(recurrence.count !== undefined ? { count: recurrence.count } : {}),
    ...(byweekday !== undefined ? { byweekday } : {}),
  });
};

/**
 * Expands an event into occurrence start instants that fall in a window.
 *
 * A one-off event yields its `startsAt` when it lands in the window. A recurring
 * event uses `RRule.between` and is capped at {@link MAX_OCCURRENCES_PER_EVENT}.
 *
 * @param startsAtIso - Event series start (UTC ISO).
 * @param recurrence - Optional recurrence rule on the event item.
 * @param from - Inclusive window start.
 * @param to - Inclusive window end.
 * @returns Occurrence start dates in ascending order.
 */
export const expandOccurrenceStarts = (
  startsAtIso: string,
  recurrence: RecurrenceRule | undefined,
  from: Date,
  to: Date,
): Date[] => {
  const startsAt = parseInstant(startsAtIso, 'starts_at');

  if (recurrence === undefined) {
    const ms = startsAt.getTime();
    if (ms >= from.getTime() && ms <= to.getTime()) return [startsAt];
    return [];
  }

  const rule = buildRRule(startsAt, recurrence);
  const dates = rule.between(from, to, true);
  if (dates.length > MAX_OCCURRENCES_PER_EVENT) {
    return dates.slice(0, MAX_OCCURRENCES_PER_EVENT);
  }
  return dates;
};

/**
 * Shifts an optional end instant by the same delta as a new occurrence start.
 *
 * @param seriesStartsAtIso - Original series start.
 * @param seriesEndsAtIso - Original series end, when present.
 * @param occurrenceStartsAt - Expanded occurrence start.
 * @returns The occurrence end ISO string, or `undefined` when the series has none.
 */
export const occurrenceEndsAt = (
  seriesStartsAtIso: string,
  seriesEndsAtIso: string | undefined,
  occurrenceStartsAt: Date,
): string | undefined => {
  if (seriesEndsAtIso === undefined) return undefined;
  const seriesStart = parseInstant(seriesStartsAtIso, 'starts_at');
  const seriesEnd = parseInstant(seriesEndsAtIso, 'ends_at');
  const durationMs = seriesEnd.getTime() - seriesStart.getTime();
  if (durationMs < 0) throw new Error('invalid_ends_at');
  return new Date(occurrenceStartsAt.getTime() + durationMs).toISOString();
};
