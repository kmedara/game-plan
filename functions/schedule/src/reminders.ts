/**
 * Due times and storage for event reminders.
 *
 * Each person picks an evening-before hour and a lead time (or turns either
 * off). Rows are shared per occurrence, not per person: every allowed time
 * gets a row, and when one comes due it goes only to RSVPs whose choice
 * matches. Only the next occurrence of a series has rows; the last reminder
 * of a date writes the next date's rows.
 */

import { REMINDER_EVENING_HOURS, REMINDER_LEAD_MINUTES } from '@gameplan/schemas';
import type { Preferences, RecurrenceRule } from '@gameplan/types';
import { expandOccurrenceStarts } from '../../lib/expand-occurrences.js';
import { loadPreferences } from '../../lib/preferences.js';
import { zonedDate, zonedWallToUtc } from '../../lib/time-zone.js';
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

/** One reminder time: the day before at a local hour, or some minutes before the start. */
export type ReminderSlot = { kind: 'evening'; hour: number } | { kind: 'before'; minutes: number };

/** Every time a person may choose. Each gets a row per occurrence. */
export const REMINDER_SLOTS: readonly ReminderSlot[] = [
  ...REMINDER_EVENING_HOURS.map((hour) => ({ kind: 'evening' as const, hour })),
  ...REMINDER_LEAD_MINUTES.map((minutes) => ({ kind: 'before' as const, minutes })),
];

/**
 * The sort-key name of a slot, such as `evening18` or `before60`.
 *
 * @param slot - The reminder time.
 * @returns A stable name.
 */
export const slotName = (slot: ReminderSlot): string =>
  slot.kind === 'evening' ? `evening${slot.hour}` : `before${slot.minutes}`;

/** The latest reminder of a date. Sending it writes the next date's rows. */
const LAST_SLOT_NAME = slotName({ kind: 'before', minutes: Math.min(...REMINDER_LEAD_MINUTES) });

/** One instant a reminder should fire for one occurrence. */
export type ReminderInstant = {
  occurrenceStartsAt: string;
  slot: ReminderSlot;
  dueAt: string;
};

/**
 * Stored reminder under `REMINDERS` / `REMINDER#…`.
 *
 * Rows written before slots existed have `kind: 'evening'` with no `hour`
 * (6 pm) or `kind: 'hour'` (one hour before).
 */
type ReminderItem = {
  PK: string;
  SK: string;
  teamId: string;
  eventId: string;
  title: string;
  occurrenceStartsAt: string;
  location?: string;
  kind: 'evening' | 'before' | 'hour';
  hour?: number;
  minutes?: number;
  dueAt: string;
};

/** RSVP row needed to decide who is coming. */
type RsvpItem = {
  userId: string;
  status: string;
};

/**
 * The slot a stored row is for, reading rows from before slots existed.
 *
 * @param row - The stored reminder.
 * @returns Its slot.
 */
const slotOfRow = (row: Pick<ReminderItem, 'kind' | 'hour' | 'minutes'>): ReminderSlot => {
  if (row.kind === 'evening') return { kind: 'evening', hour: row.hour ?? 18 };
  if (row.kind === 'hour') return { kind: 'before', minutes: 60 };
  return { kind: 'before', minutes: row.minutes ?? 60 };
};

/**
 * Whether a person wants the reminder at this slot.
 *
 * @param preferences - Their settings.
 * @param slot - The reminder time.
 * @returns `true` when the slot matches their choice.
 */
export const wantsSlot = (preferences: Preferences, slot: ReminderSlot): boolean =>
  slot.kind === 'evening'
    ? preferences.reminderEveningHour === slot.hour
    : preferences.reminderLeadMinutes === slot.minutes;

/**
 * A local hour on the day before `occurrenceStartsAt`.
 *
 * @param occurrenceStartsAt - Occurrence instant ISO string.
 * @param timeZone - The team time zone.
 * @param hour - Local hour, 0-23.
 * @returns The evening reminder instant.
 */
const eveningBefore = (occurrenceStartsAt: string, timeZone: string, hour: number): Date => {
  const { year, month, day } = zonedDate(new Date(occurrenceStartsAt), timeZone);
  const occurrenceDay = zonedWallToUtc(year, month, day, 12, 0, timeZone);
  const previous = new Date(occurrenceDay.getTime() - 24 * 60 * 60 * 1000);
  const prior = zonedDate(previous, timeZone);
  return zonedWallToUtc(prior.year, prior.month, prior.day, hour, 0, timeZone);
};

/**
 * Future reminder instants for one occurrence. Past times are omitted.
 *
 * @param occurrenceStartsAt - The occurrence instant.
 * @param timeZone - The team time zone.
 * @param now - The clock.
 * @returns One instant per slot still in the future.
 */
const instantsForOccurrence = (
  occurrenceStartsAt: string,
  timeZone: string,
  now: Date,
): ReminderInstant[] => {
  const start = new Date(occurrenceStartsAt).getTime();
  return REMINDER_SLOTS.map((slot) => ({
    slot,
    at:
      slot.kind === 'evening'
        ? eveningBefore(occurrenceStartsAt, timeZone, slot.hour)
        : new Date(start - slot.minutes * 60 * 1000),
  }))
    .filter((entry) => entry.at.getTime() > now.getTime())
    .map((entry) => ({ occurrenceStartsAt, slot: entry.slot, dueAt: entry.at.toISOString() }));
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
  const starts = expandOccurrenceStarts(input.startsAt, input.recurrence, from, horizon, input.timeZone);
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
    slotName(input.instant.slot),
  ),
  teamId: input.teamId,
  eventId: input.eventId,
  title: input.title,
  occurrenceStartsAt: input.instant.occurrenceStartsAt,
  ...(input.location !== undefined ? { location: input.location } : {}),
  ...input.instant.slot,
  dueAt: input.instant.dueAt,
});

/**
 * Writes reminder rows for the occurrence that follows `after`.
 *
 * @param input - Team, event, and the occurrence that just had its last reminder.
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
 * Who should get one reminder: RSVPs going or maybe whose chosen time matches.
 *
 * @param row - The due reminder.
 * @param slot - Its reminder time.
 * @returns Distinct user ids.
 */
const recipientsFor = async (row: ReminderItem, slot: ReminderSlot): Promise<string[]> => {
  const rsvps = await queryBySkPrefix<RsvpItem>(
    teamPk(row.teamId),
    `RSVP#${row.occurrenceStartsAt}#${row.eventId}#`,
  );
  const coming = [
    ...new Set(
      rsvps.filter((rsvp) => rsvp.status === 'going' || rsvp.status === 'maybe').map((rsvp) => rsvp.userId),
    ),
  ];
  const preferences = await Promise.all(coming.map((userId) => loadPreferences(userId)));
  return coming.filter((_userId, index) => {
    const chosen = preferences[index];
    return chosen !== undefined && wantsSlot(chosen, slot);
  });
};

/**
 * Sends due reminders to people who RSVP'd going or maybe and chose that
 * reminder time, then deletes the rows.
 *
 * @param now - The clock.
 */
export const runDueReminders = async (now: Date): Promise<void> => {
  const hi = `${REMINDER_SK_PREFIX}${now.toISOString()}#￿`;
  const due = await queryBySkBetween<ReminderItem>(REMINDERS_PK, REMINDER_SK_PREFIX, hi);
  for (const row of due) {
    const slot = slotOfRow(row);
    const [first, ...rest] = await recipientsFor(row, slot);
    if (first !== undefined) {
      await enqueueFanout({
        type: 'event_reminder',
        teamId: row.teamId,
        eventId: row.eventId,
        title: row.title,
        occurrenceStartsAt: row.occurrenceStartsAt,
        ...(row.location !== undefined ? { location: row.location } : {}),
        ...slot,
        userIds: [first, ...rest],
      });
    }
    await deleteItem(REMINDERS_PK, row.SK);
    if (row.kind === 'hour' || slotName(slot) === LAST_SLOT_NAME) {
      await chainNextReminder(
        { teamId: row.teamId, eventId: row.eventId, after: row.occurrenceStartsAt },
        now,
      );
    }
  }
};
