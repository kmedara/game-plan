/**
 * Form state for an event series, mapped to the stored recurrence rule.
 *
 * `until` and `count` stay mutually exclusive, matching RFC 5545. Weekly
 * rules send `BYDAY`. Other frequencies repeat on the series start's
 * calendar position.
 */

import type { RecurrenceRule } from '@gameplan/types';
import { RRULE_WEEKDAYS } from './schedule-calendar';
import { clockFromMinutes, wallTimeToIso } from './schedule-calendar';

/** How often a series repeats. `once` stores no recurrence. */
export type RepeatFrequency = 'once' | RecurrenceRule['frequency'];

/** How a series stops. RFC 5545 allows `until` or `count`, not both. */
export type RepeatEnd =
  | { kind: 'never' }
  | { kind: 'until'; dayKey: string }
  | { kind: 'count'; count: number };

/**
 * Builds a recurrence rule from the add-event controls.
 *
 * @param input - Frequency, interval, weekdays, and end choice.
 * @returns The rule, or `undefined` when the event does not repeat.
 */
export const recurrenceFromForm = (input: {
  frequency: RepeatFrequency;
  interval: number;
  byWeekDay: readonly string[];
  end: RepeatEnd;
  timeZone: string;
  dayKey: string;
  startMinutes: number;
}): RecurrenceRule | undefined => {
  if (input.frequency === 'once') return undefined;
  if (!Number.isInteger(input.interval) || input.interval < 1) throw new Error('invalid_interval');
  const rule: RecurrenceRule = { frequency: input.frequency, interval: input.interval };
  if (input.frequency === 'WEEKLY') {
    const days = RRULE_WEEKDAYS.filter((code) => input.byWeekDay.includes(code));
    if (days.length === 0) throw new Error('invalid_by_week_day');
    rule.byWeekDay = [...days];
  }
  if (input.end.kind === 'count') {
    if (!Number.isInteger(input.end.count) || input.end.count < 1) throw new Error('invalid_count');
    rule.count = input.end.count;
  }
  if (input.end.kind === 'until') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.end.dayKey)) throw new Error('invalid_until');
    const until = wallTimeToIso(input.timeZone, input.end.dayKey, clockFromMinutes(input.startMinutes));
    const start = wallTimeToIso(input.timeZone, input.dayKey, clockFromMinutes(input.startMinutes));
    if (new Date(until).getTime() < new Date(start).getTime()) throw new Error('invalid_until');
    rule.until = until;
  }
  return rule;
};
