/**
 * Due times and storage for evening-before and hour-before event reminders.
 */

import type { RecurrenceRule } from '@gameplan/types';
import { expandOccurrenceStarts } from '../../lib/expand-occurrences.js';
import { enqueueFanout } from '../../lib/fanout-enqueue.js';
import {
  REMINDERS_PK,
  REMINDER_SK_PREFIX,
  TABLE_PK,
  TABLE_SK,
  deleteItem,
  eventSk,
  getItem,
  putItem,
  queryBySkBetween,
  queryBySkPrefix,
  reminderSk,
  teamMetaSk,
  teamPk,
} from '../../lib/dynamo/index.js';

/** How far to look for the next occurrence. Rows are still written for only one date. */
const NEXT_OCCURRENCE_WINDOW_MS = 366 * 24 * 60 * 60 * 1000;

/** Local hour for the evening-before reminder. */
const EVENING_HOUR = 18;

/** One hour before the start. */
const HOUR_BEFORE_MS = 60 * 60 * 1000;

/** Which reminder this row is. */
export type ReminderKind = 'evening' | 'hour';

/** One instant a reminder should fire for one occurrence. */
export type ReminderInstant = {
  occurrenceStartsAt: string;
  kind: ReminderKind;
  dueAt: string;
};

/** Stored reminder under `REMINDERS` / `REMINDER#…`. */
type ReminderItem = {
  PK: string;
  SK: string;
  teamId: string;
  eventId: string;
  title: string;
  occurrenceStartsAt: string;
  location?: string;
  kind: ReminderKind;
  dueAt: string;
};

/** RSVP row needed to decide who is coming. */
type RsvpItem = {
  userId: string;
  status: string;
};

/**
 * Offset of `timeZone` from UTC at `instant`, in milliseconds.
 *
 * @param instant - The UTC instant.
 * @param timeZone - An IANA time zone.
 * @returns Wall-clock time minus UTC time.
 */
const zoneOffsetMs = (instant: Date, timeZone: string): number => {
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
  return asUtc - instant.getTime();
};

/**
 * Converts a wall-clock time in `timeZone` to a UTC instant.
 *
 * @param year - Calendar year.
 * @param month - Calendar month, 1-12.
 * @param day - Calendar day.
 * @param hour - Hour in 0-23.
 * @param minute - Minute.
 * @param timeZone - An IANA time zone.
 * @returns The UTC instant.
 */
const zonedWallToUtc = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date => {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
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
const zonedDate = (
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
 * 18:00 on the local day before `occurrenceStartsAt`.
 *
 * @param occurrenceStartsAt - Occurrence instant ISO string.
 * @param timeZone - The team time zone.
 * @returns The evening reminder instant.
 */
const eveningBefore = (occurrenceStartsAt: string, timeZone: string): Date => {
  const { year, month, day } = zonedDate(new Date(occurrenceStartsAt), timeZone);
  const occurrenceDay = zonedWallToUtc(year, month, day, 12, 0, timeZone);
  const previous = new Date(occurrenceDay.getTime() - 24 * 60 * 60 * 1000);
  const prior = zonedDate(previous, timeZone);
  return zonedWallToUtc(prior.year, prior.month, prior.day, EVENING_HOUR, 0, timeZone);
};

/**
 * Future reminder instants for one occurrence. Past times are omitted.
 *
 * @param occurrenceStartsAt - The occurrence instant.
 * @param timeZone - The team time zone.
 * @param now - The clock.
 * @returns The evening row, the hour row, or both.
 */
const instantsForOccurrence = (
  occurrenceStartsAt: string,
  timeZone: string,
  now: Date,
): ReminderInstant[] => {
  const start = new Date(occurrenceStartsAt);
  const due: Array<{ kind: ReminderKind; at: Date }> = [
    { kind: 'evening', at: eveningBefore(occurrenceStartsAt, timeZone) },
    { kind: 'hour', at: new Date(start.getTime() - HOUR_BEFORE_MS) },
  ];
  return due
    .filter((entry) => entry.at.getTime() > now.getTime())
    .map((entry) => ({
      occurrenceStartsAt,
      kind: entry.kind,
      dueAt: entry.at.toISOString(),
    }));
};

/**
 * First occurrence after `after` that still has a reminder in the future.
 *
 * @param input - Series fields, the instant to search past, and the clock.
 * @returns Reminder instants for that one date, or none when the series is over.
 */
export const reminderInstants = (input: {
  startsAt: string;
  recurrence?: RecurrenceRule;
  exdates?: string[];
  timeZone: string;
  now: Date;
  after?: string;
}): ReminderInstant[] => {
  const from = input.after !== undefined ? new Date(new Date(input.after).getTime() + 1) : input.now;
  const horizon = new Date(from.getTime() + NEXT_OCCURRENCE_WINDOW_MS);
  const starts = expandOccurrenceStarts(input.startsAt, input.recurrence, from, horizon);
  const cancelled = new Set(input.exdates ?? []);
  for (const start of starts) {
    const occurrenceStartsAt = start.toISOString();
    if (cancelled.has(occurrenceStartsAt)) continue;
    const instants = instantsForOccurrence(occurrenceStartsAt, input.timeZone, input.now);
    if (instants.length > 0) return instants;
  }
  return [];
};

/** Event fields the sweep needs to chain the following date. */
type EventReminderSource = {
  title: string;
  startsAt: string;
  location?: string;
  recurrence?: RecurrenceRule;
  exdates?: string[];
};

/**
 * Writes reminder rows for the occurrence that follows `after`.
 *
 * @param input - Team, event, and the occurrence that just had its hour reminder.
 * @param now - The clock.
 */
const chainNextReminder = async (
  input: {
    teamId: string;
    eventId: string;
    after: string;
  },
  now: Date,
): Promise<void> => {
  const event = await getItem<EventReminderSource>(teamPk(input.teamId), eventSk(input.eventId));
  if (event === undefined || event.recurrence === undefined) return;
  const team = await getItem<{ timeZone?: string }>(teamPk(input.teamId), teamMetaSk());
  if (team?.timeZone === undefined) return;
  const instants = reminderInstants({
    startsAt: event.startsAt,
    recurrence: event.recurrence,
    exdates: event.exdates,
    timeZone: team.timeZone,
    now,
    after: input.after,
  });
  for (const instant of instants) {
    await putItem(reminderItem({
      teamId: input.teamId,
      eventId: input.eventId,
      title: event.title,
      location: event.location,
      instant,
    }));
  }
};

/**
 * Builds one stored reminder row.
 *
 * @param input - Team, event, and the instant.
 * @returns The DynamoDB item.
 */
const reminderItem = (input: {
  teamId: string;
  eventId: string;
  title: string;
  location?: string;
  instant: ReminderInstant;
}): ReminderItem => ({
  [TABLE_PK]: REMINDERS_PK,
  [TABLE_SK]: reminderSk(
    input.instant.dueAt,
    input.eventId,
    input.instant.occurrenceStartsAt,
    input.instant.kind,
  ),
  teamId: input.teamId,
  eventId: input.eventId,
  title: input.title,
  occurrenceStartsAt: input.instant.occurrenceStartsAt,
  ...(input.location !== undefined ? { location: input.location } : {}),
  kind: input.instant.kind,
  dueAt: input.instant.dueAt,
});

/**
 * Deletes every reminder row for one event.
 *
 * @param eventId - The event id.
 */
export const deleteRemindersForEvent = async (eventId: string): Promise<void> => {
  const rows = await queryBySkPrefix<ReminderItem>(REMINDERS_PK, REMINDER_SK_PREFIX);
  for (const row of rows) {
    if (row.eventId === eventId) await deleteItem(REMINDERS_PK, row.SK);
  }
};

/**
 * Replaces reminder rows with the next occurrence only.
 *
 * @param input - Team zone, event fields, and the clock.
 */
export const syncReminders = async (input: {
  teamId: string;
  eventId: string;
  title: string;
  startsAt: string;
  location?: string;
  recurrence?: RecurrenceRule;
  exdates?: string[];
  timeZone: string;
  now: Date;
}): Promise<void> => {
  await deleteRemindersForEvent(input.eventId);
  const instants = reminderInstants({
    startsAt: input.startsAt,
    recurrence: input.recurrence,
    exdates: input.exdates,
    timeZone: input.timeZone,
    now: input.now,
  });
  for (const instant of instants) {
    await putItem(
      reminderItem({
        teamId: input.teamId,
        eventId: input.eventId,
        title: input.title,
        location: input.location,
        instant,
      }),
    );
  }
};

/**
 * Sends due reminders to people who RSVP'd going or maybe, then deletes the rows.
 *
 * @param now - The clock.
 */
export const runDueReminders = async (now: Date): Promise<void> => {
  const hi = `${REMINDER_SK_PREFIX}${now.toISOString()}#\uffff`;
  const due = await queryBySkBetween<ReminderItem>(REMINDERS_PK, REMINDER_SK_PREFIX, hi);
  for (const row of due) {
    const rsvps = await queryBySkPrefix<RsvpItem>(
      teamPk(row.teamId),
      `RSVP#${row.occurrenceStartsAt}#${row.eventId}#`,
    );
    const userIds = [
      ...new Set(
        rsvps
          .filter((rsvp) => rsvp.status === 'going' || rsvp.status === 'maybe')
          .map((rsvp) => rsvp.userId),
      ),
    ];
    const [first, ...rest] = userIds;
    if (first !== undefined) {
      await enqueueFanout({
        type: 'event_reminder',
        teamId: row.teamId,
        eventId: row.eventId,
        title: row.title,
        occurrenceStartsAt: row.occurrenceStartsAt,
        ...(row.location !== undefined ? { location: row.location } : {}),
        kind: row.kind,
        userIds: [first, ...rest],
      });
    }
    await deleteItem(REMINDERS_PK, row.SK);
    if (row.kind === 'hour') {
      await chainNextReminder(
        { teamId: row.teamId, eventId: row.eventId, after: row.occurrenceStartsAt },
        now,
      );
    }
  }
};
