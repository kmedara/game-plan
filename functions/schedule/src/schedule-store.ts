/**
 * DynamoDB item shapes and writes for the schedule area.
 */

import { randomUUID } from 'node:crypto';
import type { CreateEventBody, UpdateEventBody } from '@gameplan/schemas';
import type {
  EventResponse,
  EventType,
  RecurrenceRule,
  RsvpResponse,
  RsvpStatus,
  ScheduleList,
  ScheduleOccurrence,
} from '@gameplan/types';
import {
  assertScheduleWindow,
  buildRRule,
  expandOccurrenceStarts,
  occurrenceEndsAt,
  parseInstant,
} from '../../lib/expand-occurrences.js';
import { enqueueFanout } from '../../lib/fanout-enqueue.js';
import {
  EVENT_SK_PREFIX,
  TABLE_PK,
  TABLE_SK,
  eventSk,
  getItem,
  putItem,
  queryBySkBetween,
  queryBySkPrefix,
  rsvpSk,
  rsvpSkRange,
  teamMemberSk,
  teamMetaSk,
  teamPk,
} from '../../lib/dynamo/index.js';

/** Team metadata subset needed to confirm the team exists. */
type TeamMetaItem = {
  teamId: string;
  timeZone: string;
};

/** Roster membership under `TEAM#id` / `MEMBER#userId`. */
type TeamMemberItem = {
  userId: string;
  role: string;
};

/** Practice or game row under `TEAM#id` / `EVT#eventId`. */
export type EventItem = {
  PK: string;
  SK: string;
  eventId: string;
  teamId: string;
  eventType: EventType;
  title: string;
  startsAt: string;
  endsAt?: string;
  location?: string;
  latitude?: number;
  longitude?: number;
  recurrence?: RecurrenceRule;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

/** Per-occurrence RSVP under `TEAM#id` / `RSVP#occurrence#userId`. */
export type RsvpItem = {
  PK: string;
  SK: string;
  eventId: string;
  teamId: string;
  occurrenceStartsAt: string;
  userId: string;
  status: RsvpStatus;
  updatedAt: string;
};

/**
 * Maps an event item to the wire response (omits DynamoDB keys).
 *
 * @param item - The stored event row.
 * @returns The public event payload.
 */
export const toEventResponse = (item: EventItem): EventResponse => ({
  eventId: item.eventId,
  teamId: item.teamId,
  eventType: item.eventType,
  title: item.title,
  startsAt: item.startsAt,
  ...(item.endsAt !== undefined ? { endsAt: item.endsAt } : {}),
  ...(item.location !== undefined ? { location: item.location } : {}),
  ...(item.latitude !== undefined ? { latitude: item.latitude } : {}),
  ...(item.longitude !== undefined ? { longitude: item.longitude } : {}),
  ...(item.recurrence !== undefined ? { recurrence: item.recurrence } : {}),
  createdBy: item.createdBy,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});

/**
 * Loads team metadata, or throws when the team does not exist.
 *
 * @param teamId - The team id.
 * @returns The team metadata row.
 */
export const requireTeam = async (teamId: string): Promise<TeamMetaItem> => {
  const team = await getItem<TeamMetaItem>(teamPk(teamId), teamMetaSk());
  if (team === undefined) throw new Error('team_not_found');
  return team;
};

/**
 * Requires the caller to already be on the roster.
 *
 * @param teamId - The team id.
 * @param userId - The caller's user id.
 */
export const requireMembership = async (teamId: string, userId: string): Promise<void> => {
  const member = await getItem<TeamMemberItem>(teamPk(teamId), teamMemberSk(userId));
  if (member === undefined) throw new Error('not_a_member');
};

/**
 * Validates that endsAt is not before startsAt when both are present.
 *
 * @param startsAt - Series start ISO.
 * @param endsAt - Series end ISO, when set.
 */
const assertEndsAfterStarts = (startsAt: string, endsAt: string | undefined): void => {
  if (endsAt === undefined) return;
  const start = parseInstant(startsAt, 'starts_at');
  const end = parseInstant(endsAt, 'ends_at');
  if (end.getTime() < start.getTime()) throw new Error('invalid_ends_at');
};

/**
 * Creates a practice or game under the team partition.
 *
 * @param input - Caller, team, and create body.
 * @returns The created event.
 */
export const createEvent = async (input: {
  teamId: string;
  userId: string;
  body: CreateEventBody;
}): Promise<EventResponse> => {
  await requireTeam(input.teamId);
  assertEndsAfterStarts(input.body.startsAt, input.body.endsAt);
  if (input.body.recurrence !== undefined) {
    // Fail fast when byWeekDay codes are invalid.
    buildRRule(parseInstant(input.body.startsAt, 'starts_at'), input.body.recurrence);
  }

  const now = new Date().toISOString();
  const eventId = randomUUID();
  const item: EventItem = {
    [TABLE_PK]: teamPk(input.teamId),
    [TABLE_SK]: eventSk(eventId),
    eventId,
    teamId: input.teamId,
    eventType: input.body.eventType,
    title: input.body.title,
    startsAt: new Date(input.body.startsAt).toISOString(),
    ...(input.body.endsAt !== undefined
      ? { endsAt: new Date(input.body.endsAt).toISOString() }
      : {}),
    ...(input.body.location !== undefined ? { location: input.body.location } : {}),
    ...(input.body.latitude !== undefined ? { latitude: input.body.latitude } : {}),
    ...(input.body.longitude !== undefined ? { longitude: input.body.longitude } : {}),
    ...(input.body.recurrence !== undefined ? { recurrence: input.body.recurrence } : {}),
    createdBy: input.userId,
    createdAt: now,
    updatedAt: now,
  };

  await putItem(item);
  await enqueueFanout({
    type: 'schedule_changed',
    teamId: input.teamId,
    eventId,
  });
  return toEventResponse(item);
};

/**
 * Loads one event, or throws when missing.
 *
 * @param teamId - The team id.
 * @param eventId - The event id.
 * @returns The event item.
 */
export const requireEvent = async (teamId: string, eventId: string): Promise<EventItem> => {
  const item = await getItem<EventItem>(teamPk(teamId), eventSk(eventId));
  if (item === undefined || item.teamId !== teamId) throw new Error('event_not_found');
  return item;
};

/**
 * Updates a practice or game.
 *
 * @param input - Caller, team, event id, and patch body.
 * @returns The updated event.
 */
export const updateEvent = async (input: {
  teamId: string;
  eventId: string;
  body: UpdateEventBody;
}): Promise<EventResponse> => {
  await requireTeam(input.teamId);
  const existing = await requireEvent(input.teamId, input.eventId);

  const nextStartsAt =
    input.body.startsAt !== undefined
      ? new Date(input.body.startsAt).toISOString()
      : existing.startsAt;

  let nextEndsAt: string | undefined = existing.endsAt;
  if (input.body.endsAt === null) nextEndsAt = undefined;
  else if (input.body.endsAt !== undefined) {
    nextEndsAt = new Date(input.body.endsAt).toISOString();
  }

  let nextLocation: string | undefined = existing.location;
  if (input.body.location === null) nextLocation = undefined;
  else if (input.body.location !== undefined) nextLocation = input.body.location;

  let nextLatitude: number | undefined = existing.latitude;
  let nextLongitude: number | undefined = existing.longitude;
  if (input.body.latitude === null || input.body.longitude === null) {
    nextLatitude = undefined;
    nextLongitude = undefined;
  } else if (input.body.latitude !== undefined && input.body.longitude !== undefined) {
    nextLatitude = input.body.latitude;
    nextLongitude = input.body.longitude;
  }

  let nextRecurrence: RecurrenceRule | undefined = existing.recurrence;
  if (input.body.recurrence === null) nextRecurrence = undefined;
  else if (input.body.recurrence !== undefined) nextRecurrence = input.body.recurrence;

  assertEndsAfterStarts(nextStartsAt, nextEndsAt);
  if (nextRecurrence !== undefined) {
    buildRRule(parseInstant(nextStartsAt, 'starts_at'), nextRecurrence);
  }

  const now = new Date().toISOString();
  const item: EventItem = {
    ...existing,
    eventType: input.body.eventType ?? existing.eventType,
    title: input.body.title ?? existing.title,
    startsAt: nextStartsAt,
    ...(nextEndsAt !== undefined ? { endsAt: nextEndsAt } : {}),
    ...(nextLocation !== undefined ? { location: nextLocation } : {}),
    ...(nextLatitude !== undefined ? { latitude: nextLatitude } : {}),
    ...(nextLongitude !== undefined ? { longitude: nextLongitude } : {}),
    ...(nextRecurrence !== undefined ? { recurrence: nextRecurrence } : {}),
    updatedAt: now,
  };

  // Drop cleared optional fields so DynamoDB does not keep stale attributes.
  if (nextEndsAt === undefined) delete item.endsAt;
  if (nextLocation === undefined) delete item.location;
  if (nextLatitude === undefined) delete item.latitude;
  if (nextLongitude === undefined) delete item.longitude;
  if (nextRecurrence === undefined) delete item.recurrence;

  await putItem(item);
  await enqueueFanout({
    type: 'schedule_changed',
    teamId: input.teamId,
    eventId: input.eventId,
  });
  return toEventResponse(item);
};

/**
 * Expands every team event into occurrences for a visible window, with RSVPs.
 *
 * @param teamId - The team id.
 * @param fromIso - Inclusive window start.
 * @param toIso - Inclusive window end.
 * @returns Occurrences sorted by start time.
 */
export const listOccurrences = async (
  teamId: string,
  fromIso: string,
  toIso: string,
): Promise<ScheduleList> => {
  await requireTeam(teamId);
  const { from, to } = assertScheduleWindow(fromIso, toIso);

  const events = await queryBySkPrefix<EventItem>(teamPk(teamId), EVENT_SK_PREFIX);
  const range = rsvpSkRange(from.toISOString(), to.toISOString());
  const rsvpRows = await queryBySkBetween<RsvpItem>(teamPk(teamId), range.lo, range.hi);

  const rsvpsByOccurrence = new Map<string, Array<{ userId: string; status: RsvpStatus }>>();
  for (const row of rsvpRows) {
    const key = `${row.eventId}\0${row.occurrenceStartsAt}`;
    const list = rsvpsByOccurrence.get(key) ?? [];
    list.push({ userId: row.userId, status: row.status });
    rsvpsByOccurrence.set(key, list);
  }

  const occurrences: ScheduleOccurrence[] = [];
  for (const event of events) {
    const starts = expandOccurrenceStarts(event.startsAt, event.recurrence, from, to);
    for (const start of starts) {
      const startsAt = start.toISOString();
      const endsAt = occurrenceEndsAt(event.startsAt, event.endsAt, start);
      occurrences.push({
        eventId: event.eventId,
        eventType: event.eventType,
        title: event.title,
        startsAt,
        ...(endsAt !== undefined ? { endsAt } : {}),
        ...(event.location !== undefined ? { location: event.location } : {}),
        ...(event.latitude !== undefined ? { latitude: event.latitude } : {}),
        ...(event.longitude !== undefined ? { longitude: event.longitude } : {}),
        rsvps: rsvpsByOccurrence.get(`${event.eventId}\0${startsAt}`) ?? [],
      });
    }
  }

  occurrences.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return {
    teamId,
    from: from.toISOString(),
    to: to.toISOString(),
    occurrences,
  };
};

/**
 * Upserts the caller's RSVP for one occurrence.
 *
 * @param input - Team, caller, event, occurrence, and status.
 * @returns The stored RSVP.
 */
export const upsertRsvp = async (input: {
  teamId: string;
  userId: string;
  eventId: string;
  occurrenceStartsAt: string;
  status: RsvpStatus;
}): Promise<RsvpResponse> => {
  await requireTeam(input.teamId);
  const event = await requireEvent(input.teamId, input.eventId);
  const occurrence = parseInstant(input.occurrenceStartsAt, 'occurrence_starts_at');
  const occurrenceIso = occurrence.toISOString();

  // Confirm the instant is a real occurrence of this event (one day around it).
  const dayBefore = new Date(occurrence.getTime() - 12 * 60 * 60 * 1000);
  const dayAfter = new Date(occurrence.getTime() + 12 * 60 * 60 * 1000);
  const matches = expandOccurrenceStarts(event.startsAt, event.recurrence, dayBefore, dayAfter);
  const isOccurrence = matches.some((date) => date.toISOString() === occurrenceIso);
  if (!isOccurrence) throw new Error('occurrence_not_found');

  const now = new Date().toISOString();
  const item: RsvpItem = {
    [TABLE_PK]: teamPk(input.teamId),
    [TABLE_SK]: rsvpSk(occurrenceIso, input.userId),
    eventId: input.eventId,
    teamId: input.teamId,
    occurrenceStartsAt: occurrenceIso,
    userId: input.userId,
    status: input.status,
    updatedAt: now,
  };
  await putItem(item);

  return {
    eventId: input.eventId,
    occurrenceStartsAt: occurrenceIso,
    userId: input.userId,
    status: input.status,
    updatedAt: now,
  };
};
