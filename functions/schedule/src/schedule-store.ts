/**
 * DynamoDB item shapes and writes for the schedule area.
 */

import { randomUUID } from 'node:crypto';
import type { CreateEventBody, ExceptionEventBody, UpdateEventBody } from '@gameplan/schemas';
import type {
  CarpoolResponse,
  EventResponse,
  EventType,
  GameSide,
  RecurrenceRule,
  LineupResponse,
  LineupSlot,
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
import { dropEventFixtureId } from '../../lib/fixture-release.js';
import { listTeamMemberIds } from '../../lib/team-roster.js';
import { deleteRemindersForEvent, syncReminders } from './reminders.js';
import { publicCarpoolOffer, syncCarpoolChats, type StoredCarpoolOffer } from './carpool-chat.js';
import {
  EVENT_SK_PREFIX,
  LINEUP_SK_PREFIX,
  TABLE_PK,
  TABLE_SK,
  deleteItem,
  carpoolSk,
  eventSk,
  getItem,
  lineupSk,
  putItem,
  queryBySkBetween,
  queryBySkPrefix,
  rsvpSk,
  rsvpSkLegacy,
  rsvpSkRange,
  teamMemberSk,
  teamMetaSk,
  teamPk,
} from '../../lib/dynamo/index.js';

/** Team metadata subset the schedule area reads. */
type TeamMetaItem = {
  teamId: string;
  name: string;
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
  notes?: string;
  latitude?: number;
  longitude?: number;
  recurrence?: RecurrenceRule;
  /** Series instants that no longer occur. */
  exdates?: string[];
  /** Series this one-off date was split from. */
  seriesEventId?: string;
  /** Series instant this exception replaced. */
  originalStartsAt?: string;
  /** Free-text opponent until both clubs share one fixture. */
  opponentName?: string;
  /** Home or away. Set before a game can be shared. */
  side?: GameSide;
  /** Shared fixture, once this game is proposed or linked. */
  fixtureId?: string;
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
/** Fields that decide whether a time or place push is warranted. */
type MoveFields = {
  startsAt: string;
  endsAt?: string;
  location?: string;
  latitude?: number;
  longitude?: number;
};

/**
 * Classifies a time or place change.
 *
 * @param before - The stored event.
 * @param after - The event after the write.
 * @returns The change kind, or `undefined` when time and place are unchanged.
 */
export const moveChange = (before: MoveFields, after: MoveFields): 'time' | 'location' | 'both' | undefined => {
  const timeChanged = before.startsAt !== after.startsAt || (before.endsAt ?? '') !== (after.endsAt ?? '');
  const placeChanged =
    (before.location ?? '') !== (after.location ?? '') ||
    (before.latitude ?? null) !== (after.latitude ?? null) ||
    (before.longitude ?? null) !== (after.longitude ?? null);
  if (timeChanged && placeChanged) return 'both';
  if (timeChanged) return 'time';
  if (placeChanged) return 'location';
  return undefined;
};

/**
 * Enqueues a time or place push when those fields changed.
 *
 * @param input - Team, event, title, optional single date, and the before/after fields.
 */
const enqueueMove = async (input: {
  teamId: string;
  eventId: string;
  title: string;
  occurrenceStartsAt?: string;
  before: MoveFields;
  after: MoveFields;
}): Promise<void> => {
  const change = moveChange(input.before, input.after);
  if (change === undefined) return;
  await enqueueFanout({
    type: 'event_moved',
    teamId: input.teamId,
    eventId: input.eventId,
    title: input.title,
    ...(input.occurrenceStartsAt !== undefined ? { occurrenceStartsAt: input.occurrenceStartsAt } : {}),
    change,
  });
};

export const toEventResponse = (item: EventItem): EventResponse => ({
  eventId: item.eventId,
  teamId: item.teamId,
  eventType: item.eventType,
  title: item.title,
  startsAt: item.startsAt,
  ...(item.endsAt !== undefined ? { endsAt: item.endsAt } : {}),
  ...(item.location !== undefined ? { location: item.location } : {}),
  ...(item.notes !== undefined ? { notes: item.notes } : {}),
  ...(item.latitude !== undefined ? { latitude: item.latitude } : {}),
  ...(item.longitude !== undefined ? { longitude: item.longitude } : {}),
  ...(item.recurrence !== undefined ? { recurrence: item.recurrence } : {}),
  ...(item.seriesEventId !== undefined ? { seriesEventId: item.seriesEventId } : {}),
  ...(item.originalStartsAt !== undefined ? { originalStartsAt: item.originalStartsAt } : {}),
  ...(item.exdates !== undefined && item.exdates.length > 0 ? { exdates: item.exdates } : {}),
  ...(item.opponentName !== undefined ? { opponentName: item.opponentName } : {}),
  ...(item.side !== undefined ? { side: item.side } : {}),
  ...(item.fixtureId !== undefined ? { fixtureId: item.fixtureId } : {}),
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
  const team = await requireTeam(input.teamId);
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
    ...(input.body.notes !== undefined ? { notes: input.body.notes } : {}),
    ...(input.body.latitude !== undefined ? { latitude: input.body.latitude } : {}),
    ...(input.body.longitude !== undefined ? { longitude: input.body.longitude } : {}),
    ...(input.body.recurrence !== undefined ? { recurrence: input.body.recurrence } : {}),
    ...(input.body.eventType === 'game' && input.body.opponentName !== undefined
      ? { opponentName: input.body.opponentName }
      : {}),
    ...(input.body.eventType === 'game' && input.body.side !== undefined ? { side: input.body.side } : {}),
    createdBy: input.userId,
    createdAt: now,
    updatedAt: now,
  };

  await putItem(item);
  await syncReminders({
    teamId: input.teamId,
    eventId,
    title: item.title,
    startsAt: item.startsAt,
    location: item.location,
    recurrence: item.recurrence,
    timeZone: team.timeZone,
    now: new Date(now),
  });
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
/**
 * True when a patch would change the facts a linked fixture owns.
 *
 * @param body - The event patch.
 * @returns Whether start, place, opponent, side, type, or recurrence is present.
 */
const fixtureLockedPatch = (body: UpdateEventBody): boolean =>
  body.startsAt !== undefined ||
  body.endsAt !== undefined ||
  body.location !== undefined ||
  body.latitude !== undefined ||
  body.longitude !== undefined ||
  body.opponentName !== undefined ||
  body.side !== undefined ||
  body.eventType !== undefined ||
  body.recurrence !== undefined;

export const updateEvent = async (input: {
  teamId: string;
  eventId: string;
  body: UpdateEventBody;
}): Promise<EventResponse> => {
  const team = await requireTeam(input.teamId);
  const existing = await requireEvent(input.teamId, input.eventId);
  if (existing.fixtureId !== undefined && fixtureLockedPatch(input.body)) {
    throw new Error('fixture_locked');
  }
  const nextType = input.body.eventType ?? existing.eventType;
  // `null` clears a game field, which is fine on any type (the app sends it
  // for every non-game); only a real value is refused off a game.
  if (
    nextType !== 'game' &&
    ((input.body.opponentName !== undefined && input.body.opponentName !== null) ||
      (input.body.side !== undefined && input.body.side !== null))
  ) {
    throw new Error('not_a_game');
  }

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

  let nextNotes: string | undefined = existing.notes;
  if (input.body.notes === null) nextNotes = undefined;
  else if (input.body.notes !== undefined) nextNotes = input.body.notes;

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

  if (nextRecurrence !== undefined) {
    buildRRule(parseInstant(nextStartsAt, 'starts_at'), nextRecurrence);
  }

  let nextOpponent: string | undefined = existing.opponentName;
  let nextSide: GameSide | undefined = existing.side;
  if (nextType !== 'game') {
    nextOpponent = undefined;
    nextSide = undefined;
  } else {
    if (input.body.opponentName === null) nextOpponent = undefined;
    else if (input.body.opponentName !== undefined) nextOpponent = input.body.opponentName;
    if (input.body.side === null) nextSide = undefined;
    else if (input.body.side !== undefined) nextSide = input.body.side;
  }

  const now = new Date().toISOString();
  const item: EventItem = {
    ...existing,
    eventType: nextType,
    title: input.body.title ?? existing.title,
    startsAt: nextStartsAt,
    ...(nextEndsAt !== undefined ? { endsAt: nextEndsAt } : {}),
    ...(nextLocation !== undefined ? { location: nextLocation } : {}),
    ...(nextNotes !== undefined ? { notes: nextNotes } : {}),
    ...(nextLatitude !== undefined ? { latitude: nextLatitude } : {}),
    ...(nextLongitude !== undefined ? { longitude: nextLongitude } : {}),
    ...(nextRecurrence !== undefined ? { recurrence: nextRecurrence } : {}),
    ...(nextOpponent !== undefined ? { opponentName: nextOpponent } : {}),
    ...(nextSide !== undefined ? { side: nextSide } : {}),
    updatedAt: now,
  };

  // Drop cleared optional fields so DynamoDB does not keep stale attributes.
  if (nextEndsAt === undefined) delete item.endsAt;
  if (nextLocation === undefined) delete item.location;
  if (nextNotes === undefined) delete item.notes;
  if (nextLatitude === undefined) delete item.latitude;
  if (nextLongitude === undefined) delete item.longitude;
  if (nextRecurrence === undefined) delete item.recurrence;
  if (nextOpponent === undefined) delete item.opponentName;
  if (nextSide === undefined) delete item.side;

  await putItem(item);
  await syncReminders({
    teamId: input.teamId,
    eventId: input.eventId,
    title: item.title,
    startsAt: item.startsAt,
    location: item.location,
    recurrence: item.recurrence,
    exdates: item.exdates,
    timeZone: team.timeZone,
    now: new Date(now),
  });
  await enqueueFanout({
    type: 'schedule_changed',
    teamId: input.teamId,
    eventId: input.eventId,
  });
  await enqueueMove({
    teamId: input.teamId,
    eventId: input.eventId,
    title: item.title,
    occurrenceStartsAt:
      item.seriesEventId !== undefined
        ? item.originalStartsAt
        : item.recurrence === undefined
          ? item.startsAt
          : undefined,
    before: existing,
    after: item,
  });
  return toEventResponse(item);
};

/** Time, place, and opponent written onto one club's game from a fixture. */
export type SharedEventFacts = {
  startsAt: string;
  endsAt?: string;
  location?: string;
  latitude?: number;
  longitude?: number;
  opponentName?: string;
  side?: GameSide;
  fixtureId?: string;
};

/**
 * Writes shared fixture facts onto one event and notifies that club.
 *
 * The fixture store calls this. It is not the member-facing event patch, so a
 * linked game can still move when the fixture itself changes.
 *
 * @param teamId - The team that owns the event.
 * @param eventId - The event to update.
 * @param facts - The next shared start, place, opponent, and fixture id.
 * @returns The updated event.
 */
export const writeEventFacts = async (
  teamId: string,
  eventId: string,
  facts: SharedEventFacts,
): Promise<EventResponse> => {
  const team = await requireTeam(teamId);
  const existing = await requireEvent(teamId, eventId);
  const now = new Date().toISOString();
  const item: EventItem = {
    ...existing,
    startsAt: new Date(facts.startsAt).toISOString(),
    updatedAt: now,
    ...(facts.opponentName !== undefined ? { opponentName: facts.opponentName } : {}),
    ...(facts.side !== undefined ? { side: facts.side } : {}),
    ...(facts.fixtureId !== undefined ? { fixtureId: facts.fixtureId } : {}),
  };
  if (facts.endsAt !== undefined) item.endsAt = new Date(facts.endsAt).toISOString();
  else delete item.endsAt;
  if (facts.location !== undefined) item.location = facts.location;
  else delete item.location;
  if (facts.latitude !== undefined && facts.longitude !== undefined) {
    item.latitude = facts.latitude;
    item.longitude = facts.longitude;
  } else {
    delete item.latitude;
    delete item.longitude;
  }
  await putItem(item);
  await syncReminders({
    teamId,
    eventId,
    title: item.title,
    startsAt: item.startsAt,
    location: item.location,
    recurrence: item.recurrence,
    exdates: item.exdates,
    timeZone: team.timeZone,
    now: new Date(now),
  });
  await enqueueFanout({ type: 'schedule_changed', teamId, eventId });
  await enqueueMove({
    teamId,
    eventId,
    title: item.title,
    occurrenceStartsAt: item.recurrence === undefined ? item.startsAt : undefined,
    before: existing,
    after: item,
  });
  return toEventResponse(item);
};

/**
 * Records that a game belongs to a fixture without changing its start or place.
 *
 * @param teamId - The team that owns the event.
 * @param eventId - The event to mark.
 * @param fixtureId - The fixture id.
 */
export const attachFixtureId = async (
  teamId: string,
  eventId: string,
  fixtureId: string,
): Promise<void> => {
  const existing = await requireEvent(teamId, eventId);
  const now = new Date().toISOString();
  await putItem({ ...existing, fixtureId, updatedAt: now });
  await enqueueFanout({ type: 'schedule_changed', teamId, eventId });
};

/**
 * Drops the fixture id and leaves the last start, place, and opponent name.
 *
 * @param teamId - The team that owns the event.
 * @param eventId - The event to detach.
 */
export const detachFixtureId = async (teamId: string, eventId: string): Promise<void> => {
  await requireEvent(teamId, eventId);
  if (!(await dropEventFixtureId(teamId, eventId))) return;
  await enqueueFanout({ type: 'schedule_changed', teamId, eventId });
};

/**
 * Loads every event row on a team.
 *
 * @param teamId - The team id.
 * @returns Event items, including split-off dates.
 */
const listEventItems = (teamId: string): Promise<EventItem[]> =>
  queryBySkPrefix<EventItem>(teamPk(teamId), EVENT_SK_PREFIX);

/**
 * Resolves the series row for an event or one of its split-off dates.
 *
 * @param teamId - The team id.
 * @param eventId - A series id or an exception id.
 * @returns The series item.
 */
const requireSeries = async (teamId: string, eventId: string): Promise<EventItem> => {
  const event = await requireEvent(teamId, eventId);
  if (event.seriesEventId === undefined) return event;
  return requireEvent(teamId, event.seriesEventId);
};

/**
 * Whether the event repeats onto exactly this instant, ignoring cancellations.
 *
 * @param event - The series or one-off row.
 * @param occurrenceIso - Canonical occurrence instant (UTC ISO).
 * @param timeZone - The team's time zone, which the repeats follow.
 * @returns `true` when the expansion lands on the instant.
 */
const landsOn = (event: EventItem, occurrenceIso: string, timeZone: string): boolean => {
  const occurrence = parseInstant(occurrenceIso, 'occurrence_starts_at');
  const dayBefore = new Date(occurrence.getTime() - 12 * 60 * 60 * 1000);
  const dayAfter = new Date(occurrence.getTime() + 12 * 60 * 60 * 1000);
  return expandOccurrenceStarts(event.startsAt, event.recurrence, dayBefore, dayAfter, timeZone).some(
    (date) => date.toISOString() === occurrenceIso,
  );
};

/**
 * Confirms an instant is a real, uncancelled occurrence of the event.
 *
 * @param event - The series or one-off row.
 * @param occurrenceStartsAt - The occurrence instant from the client.
 * @param timeZone - The team's time zone.
 * @returns The canonical occurrence instant.
 * @throws `occurrence_not_found` otherwise.
 */
const assertLiveOccurrence = (event: EventItem, occurrenceStartsAt: string, timeZone: string): string => {
  const occurrenceIso = parseInstant(occurrenceStartsAt, 'occurrence_starts_at').toISOString();
  if (event.exdates?.includes(occurrenceIso) === true || !landsOn(event, occurrenceIso, timeZone)) {
    throw new Error('occurrence_not_found');
  }
  return occurrenceIso;
};

/**
 * Confirms an instant belongs to a series, including dates already cancelled.
 *
 * @param series - The series row.
 * @param occurrenceIso - The original series instant.
 * @param timeZone - The team's time zone.
 */
const assertSeriesInstant = (series: EventItem, occurrenceIso: string, timeZone: string): void => {
  if (series.exdates?.includes(occurrenceIso)) return;
  if (!landsOn(series, occurrenceIso, timeZone)) throw new Error('occurrence_not_found');
};

/**
 * Deletes a series, or a one-off event, and every date split off from it.
 *
 * @param teamId - The team id.
 * @param eventId - A series id, one-off id, or exception id.
 */
export const deleteEvent = async (teamId: string, eventId: string): Promise<void> => {
  await requireTeam(teamId);
  const series = await requireSeries(teamId, eventId);
  const events = await listEventItems(teamId);
  const rows = events.filter(
    (event) => event.eventId === series.eventId || event.seriesEventId === series.eventId,
  );
  if (rows.some((row) => row.fixtureId !== undefined)) throw new Error('fixture_linked');
  for (const row of rows) {
    await deleteItem(teamPk(teamId), eventSk(row.eventId));
    await deleteRemindersForEvent(row.eventId);
  }
  await enqueueFanout({
    type: 'schedule_changed',
    teamId,
    eventId: series.eventId,
  });
};

/**
 * Cancels one series instant and removes a split-off row for that instant.
 *
 * @param input - Team, event, and the original series start.
 */
export const cancelOccurrence = async (input: {
  teamId: string;
  eventId: string;
  occurrenceStartsAt: string;
}): Promise<void> => {
  const { timeZone } = await requireTeam(input.teamId);
  const series = await requireSeries(input.teamId, input.eventId);
  const occurrenceIso = new Date(input.occurrenceStartsAt).toISOString();
  assertSeriesInstant(series, occurrenceIso, timeZone);

  const events = await listEventItems(input.teamId);
  for (const event of events) {
    if (event.seriesEventId === series.eventId && event.originalStartsAt === occurrenceIso) {
      await deleteItem(teamPk(input.teamId), eventSk(event.eventId));
    }
  }

  const exdates = [...new Set([...(series.exdates ?? []), occurrenceIso])];
  const now = new Date().toISOString();
  await putItem({ ...series, exdates, updatedAt: now });
  const team = await requireTeam(input.teamId);
  await syncReminders({
    teamId: input.teamId,
    eventId: series.eventId,
    title: series.title,
    startsAt: series.startsAt,
    location: series.location,
    recurrence: series.recurrence,
    exdates,
    timeZone: team.timeZone,
    now: new Date(now),
  });
  await enqueueFanout({
    type: 'schedule_changed',
    teamId: input.teamId,
    eventId: series.eventId,
  });
  await enqueueFanout({
    type: 'event_moved',
    teamId: input.teamId,
    eventId: series.eventId,
    title: series.title,
    occurrenceStartsAt: occurrenceIso,
    change: 'time',
  });
};

/**
 * Writes a one-off replacement for a single series instant.
 *
 * A second edit of the same instant updates the existing replacement.
 *
 * @param input - Team, series or exception id, and the patch.
 * @returns The split-off event.
 */
export const saveOccurrenceException = async (input: {
  teamId: string;
  userId: string;
  eventId: string;
  body: ExceptionEventBody;
}): Promise<EventResponse> => {
  const { timeZone } = await requireTeam(input.teamId);
  const series = await requireSeries(input.teamId, input.eventId);
  const occurrenceIso = new Date(input.body.occurrenceStartsAt).toISOString();
  assertSeriesInstant(series, occurrenceIso, timeZone);

  const { occurrenceStartsAt: _ignored, ...patch } = input.body;
  const nextStartsAt = patch.startsAt ?? occurrenceIso;
  const durationMs =
    series.endsAt === undefined
      ? undefined
      : new Date(series.endsAt).getTime() - new Date(series.startsAt).getTime();
  const inheritedEnd =
    durationMs === undefined ? undefined : new Date(new Date(nextStartsAt).getTime() + durationMs).toISOString();
  const nextEndsAt = patch.endsAt === null ? undefined : (patch.endsAt ?? inheritedEnd);
  if (nextEndsAt !== undefined && new Date(nextEndsAt).getTime() <= new Date(nextStartsAt).getTime()) {
    throw new Error('invalid_ends_at');
  }

  const events = await listEventItems(input.teamId);
  const existing = events.find(
    (event) => event.seriesEventId === series.eventId && event.originalStartsAt === occurrenceIso,
  );
  if (existing !== undefined) {
    return updateEvent({
      teamId: input.teamId,
      eventId: existing.eventId,
      body: { ...patch, recurrence: null },
    });
  }

  const draft = await createEvent({
    teamId: input.teamId,
    userId: input.userId,
    body: {
      eventType: patch.eventType ?? series.eventType,
      title: patch.title ?? series.title,
      startsAt: nextStartsAt,
      ...(patch.endsAt === null
        ? {}
        : patch.endsAt !== undefined
          ? { endsAt: patch.endsAt }
          : inheritedEnd !== undefined
            ? { endsAt: inheritedEnd }
            : {}),
      ...(patch.location === null
        ? {}
        : patch.location !== undefined
          ? { location: patch.location }
          : series.location !== undefined
            ? { location: series.location }
            : {}),
      ...(patch.notes === null
        ? {}
        : patch.notes !== undefined
          ? { notes: patch.notes }
          : series.notes !== undefined
            ? { notes: series.notes }
            : {}),
      ...(patch.latitude === null || patch.longitude === null
        ? {}
        : patch.latitude !== undefined && patch.longitude !== undefined
          ? { latitude: patch.latitude, longitude: patch.longitude }
          : series.latitude !== undefined && series.longitude !== undefined
            ? { latitude: series.latitude, longitude: series.longitude }
            : {}),
    },
  });

  const created = await requireEvent(input.teamId, draft.eventId);
  const now = new Date().toISOString();
  await putItem({
    ...created,
    seriesEventId: series.eventId,
    originalStartsAt: occurrenceIso,
    updatedAt: now,
  });
  const exdates = [...new Set([...(series.exdates ?? []), occurrenceIso])];
  await putItem({ ...series, exdates, updatedAt: now });
  const team = await requireTeam(input.teamId);
  await syncReminders({
    teamId: input.teamId,
    eventId: series.eventId,
    title: series.title,
    startsAt: series.startsAt,
    location: series.location,
    recurrence: series.recurrence,
    exdates,
    timeZone: team.timeZone,
    now: new Date(now),
  });
  await enqueueFanout({
    type: 'schedule_changed',
    teamId: input.teamId,
    eventId: series.eventId,
  });
  await enqueueMove({
    teamId: input.teamId,
    eventId: created.eventId,
    title: created.title,
    occurrenceStartsAt: occurrenceIso,
    before: {
      startsAt: occurrenceIso,
      endsAt: inheritedEnd,
      location: series.location,
      latitude: series.latitude,
      longitude: series.longitude,
    },
    after: created,
  });
  return toEventResponse({
    ...created,
    seriesEventId: series.eventId,
    originalStartsAt: occurrenceIso,
    updatedAt: now,
  });
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
  const { timeZone } = await requireTeam(teamId);
  const { from, to } = assertScheduleWindow(fromIso, toIso);

  const events = await queryBySkPrefix<EventItem>(teamPk(teamId), EVENT_SK_PREFIX);
  const range = rsvpSkRange(from.toISOString(), to.toISOString());
  const rsvpRows = await queryBySkBetween<RsvpItem>(teamPk(teamId), range.lo, range.hi);

  const rsvpsByOccurrence = new Map<
    string,
    Map<string, { userId: string; status: RsvpStatus; updatedAt: string }>
  >();
  for (const row of rsvpRows) {
    const key = `${row.eventId}\0${row.occurrenceStartsAt}`;
    const byUser = rsvpsByOccurrence.get(key) ?? new Map();
    const existing = byUser.get(row.userId);
    if (existing === undefined || row.updatedAt >= existing.updatedAt) {
      byUser.set(row.userId, {
        userId: row.userId,
        status: row.status,
        updatedAt: row.updatedAt,
      });
    }
    rsvpsByOccurrence.set(key, byUser);
  }

  const replaced = new Set(
    events
      .filter((event) => event.seriesEventId !== undefined && event.originalStartsAt !== undefined)
      .map((event) => `${event.seriesEventId}\0${event.originalStartsAt}`),
  );

  const occurrences: ScheduleOccurrence[] = [];
  for (const event of events) {
    const cancelled = new Set(event.exdates ?? []);
    const starts = expandOccurrenceStarts(event.startsAt, event.recurrence, from, to, timeZone);
    for (const start of starts) {
      const startsAt = start.toISOString();
      if (cancelled.has(startsAt)) continue;
      if (replaced.has(`${event.eventId}\0${startsAt}`)) continue;
      const endsAt = occurrenceEndsAt(event.startsAt, event.endsAt, start);
      const byUser = rsvpsByOccurrence.get(`${event.eventId}\0${startsAt}`);
      const rsvps: Array<{ userId: string; status: RsvpStatus }> = [];
      if (byUser !== undefined) {
        for (const entry of byUser.values()) {
          rsvps.push({ userId: entry.userId, status: entry.status });
        }
      }
      const recurring = event.recurrence !== undefined || event.seriesEventId !== undefined;
      const seriesEventId = event.seriesEventId ?? (event.recurrence !== undefined ? event.eventId : undefined);
      const originalStartsAt =
        event.originalStartsAt ?? (event.recurrence !== undefined ? startsAt : undefined);
      occurrences.push({
        eventId: event.eventId,
        eventType: event.eventType,
        title: event.title,
        startsAt,
        ...(endsAt !== undefined ? { endsAt } : {}),
        ...(event.location !== undefined ? { location: event.location } : {}),
        ...(event.notes !== undefined ? { notes: event.notes } : {}),
        ...(event.latitude !== undefined ? { latitude: event.latitude } : {}),
        ...(event.longitude !== undefined ? { longitude: event.longitude } : {}),
        ...(event.opponentName !== undefined ? { opponentName: event.opponentName } : {}),
        ...(event.side !== undefined ? { side: event.side } : {}),
        ...(event.fixtureId !== undefined ? { fixtureId: event.fixtureId } : {}),
        recurring,
        ...(seriesEventId !== undefined ? { seriesEventId } : {}),
        ...(originalStartsAt !== undefined ? { originalStartsAt } : {}),
        rsvps,
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
  const { timeZone } = await requireTeam(input.teamId);
  const event = await requireEvent(input.teamId, input.eventId);
  const occurrenceIso = assertLiveOccurrence(event, input.occurrenceStartsAt, timeZone);

  const now = new Date().toISOString();
  const pk = teamPk(input.teamId);
  const item: RsvpItem = {
    [TABLE_PK]: pk,
    [TABLE_SK]: rsvpSk(occurrenceIso, input.eventId, input.userId),
    eventId: input.eventId,
    teamId: input.teamId,
    occurrenceStartsAt: occurrenceIso,
    userId: input.userId,
    status: input.status,
    updatedAt: now,
  };
  await putItem(item);
  // Drop pre-eventId rows that collided across same-time events.
  await deleteItem(pk, rsvpSkLegacy(occurrenceIso, input.userId));

  return {
    eventId: input.eventId,
    occurrenceStartsAt: occurrenceIso,
    userId: input.userId,
    status: input.status,
    updatedAt: now,
  };
};

/** Stored lineup under `TEAM#id` / `LINEUP#occurrence#eventId`. */
type LineupItem = {
  eventId: string;
  teamId: string;
  occurrenceStartsAt: string;
  slots: LineupSlot[];
};

/**
 * Confirms the instant is a real, uncancelled occurrence of a game.
 *
 * @param teamId - The team id.
 * @param eventId - The event id.
 * @param occurrenceStartsAt - The occurrence instant from the client.
 * @returns The event and the canonical occurrence instant.
 */
const requireGameOccurrence = async (
  teamId: string,
  eventId: string,
  occurrenceStartsAt: string,
): Promise<{ event: EventItem; occurrenceIso: string }> => {
  const [{ timeZone }, event] = await Promise.all([requireTeam(teamId), requireEvent(teamId, eventId)]);
  if (event.eventType !== 'game') throw new Error('not_a_game');
  return { event, occurrenceIso: assertLiveOccurrence(event, occurrenceStartsAt, timeZone) };
};

/**
 * Reads a game lineup. A missing row is an empty lineup.
 *
 * @param input - Team, event, and occurrence.
 * @returns The stored slots, or none.
 */
export const getLineup = async (input: {
  teamId: string;
  eventId: string;
  occurrenceStartsAt: string;
}): Promise<LineupResponse> => {
  await requireTeam(input.teamId);
  const { occurrenceIso } = await requireGameOccurrence(
    input.teamId,
    input.eventId,
    input.occurrenceStartsAt,
  );
  const item = await getItem<LineupItem>(teamPk(input.teamId), lineupSk(occurrenceIso, input.eventId));
  return {
    eventId: input.eventId,
    occurrenceStartsAt: occurrenceIso,
    slots: item?.slots ?? [],
  };
};

/**
 * Returns the latest earlier game lineup in the same series, or an empty lineup.
 *
 * @param input - Team, event, and the occurrence to look behind.
 * @returns Slots from that earlier game, addressed as that earlier occurrence.
 */
export const getPreviousLineup = async (input: {
  teamId: string;
  eventId: string;
  occurrenceStartsAt: string;
}): Promise<LineupResponse> => {
  await requireTeam(input.teamId);
  const { event, occurrenceIso } = await requireGameOccurrence(
    input.teamId,
    input.eventId,
    input.occurrenceStartsAt,
  );
  const seriesId = event.seriesEventId ?? event.eventId;
  const events = await queryBySkPrefix<EventItem>(teamPk(input.teamId), EVENT_SK_PREFIX);
  const games = new Map(
    events
      .filter((row) => row.eventType === 'game' && (row.seriesEventId ?? row.eventId) === seriesId)
      .map((row) => [row.eventId, row]),
  );
  const lineups = await queryBySkPrefix<LineupItem>(teamPk(input.teamId), LINEUP_SK_PREFIX);
  const earlier = lineups
    .filter(
      (row) =>
        games.has(row.eventId) &&
        row.occurrenceStartsAt < occurrenceIso &&
        row.slots.length > 0,
    )
    .sort((a, b) => b.occurrenceStartsAt.localeCompare(a.occurrenceStartsAt));
  const found = earlier[0];
  if (found === undefined) {
    return { eventId: input.eventId, occurrenceStartsAt: occurrenceIso, slots: [] };
  }
  return {
    eventId: found.eventId,
    occurrenceStartsAt: found.occurrenceStartsAt,
    slots: found.slots,
  };
};

/**
 * Replaces the lineup for one game occurrence.
 *
 * @param input - Team, event, occurrence, and the full slot list.
 * @returns The stored lineup.
 */
export const putLineup = async (input: {
  teamId: string;
  eventId: string;
  occurrenceStartsAt: string;
  slots: LineupSlot[];
}): Promise<LineupResponse> => {
  await requireTeam(input.teamId);
  const { occurrenceIso } = await requireGameOccurrence(
    input.teamId,
    input.eventId,
    input.occurrenceStartsAt,
  );
  const memberIds = new Set(await listTeamMemberIds(input.teamId));
  if (input.slots.some((slot) => !memberIds.has(slot.userId))) {
    throw new Error('lineup_member_not_found');
  }
  const item: LineupItem & { PK: string; SK: string } = {
    [TABLE_PK]: teamPk(input.teamId),
    [TABLE_SK]: lineupSk(occurrenceIso, input.eventId),
    eventId: input.eventId,
    teamId: input.teamId,
    occurrenceStartsAt: occurrenceIso,
    slots: input.slots,
  };
  await putItem(item);
  return {
    eventId: input.eventId,
    occurrenceStartsAt: occurrenceIso,
    slots: input.slots,
  };
};

/** Stored rides under `TEAM#id` / `CARPOOL#occurrence#eventId`. */
type CarpoolItem = {
  eventId: string;
  teamId: string;
  occurrenceStartsAt: string;
  offers: StoredCarpoolOffer[];
};

/**
 * Confirms the instant is a real, uncancelled occurrence of the event.
 *
 * @param teamId - The team id.
 * @param eventId - The event id.
 * @param occurrenceStartsAt - The occurrence instant from the client.
 * @returns The canonical occurrence instant.
 */
export const requireOccurrence = async (
  teamId: string,
  eventId: string,
  occurrenceStartsAt: string,
): Promise<string> => {
  const [{ timeZone }, event] = await Promise.all([requireTeam(teamId), requireEvent(teamId, eventId)]);
  return assertLiveOccurrence(event, occurrenceStartsAt, timeZone);
};

const memberIdsOf = async (teamId: string): Promise<Set<string>> => new Set(await listTeamMemberIds(teamId));

const writeCarpool = async (
  teamId: string,
  eventId: string,
  occurrenceIso: string,
  previous: readonly StoredCarpoolOffer[],
  next: readonly StoredCarpoolOffer[],
): Promise<CarpoolResponse> => {
  const offers = await syncCarpoolChats(previous, next);
  if (offers.length === 0) {
    await deleteItem(teamPk(teamId), carpoolSk(occurrenceIso, eventId));
  } else {
    const item: CarpoolItem & { PK: string; SK: string } = {
      [TABLE_PK]: teamPk(teamId),
      [TABLE_SK]: carpoolSk(occurrenceIso, eventId),
      eventId,
      teamId,
      occurrenceStartsAt: occurrenceIso,
      offers,
    };
    await putItem(item);
  }
  return { eventId, occurrenceStartsAt: occurrenceIso, offers: offers.map(publicCarpoolOffer) };
};

/**
 * Reads rides for one occurrence. A missing row is an empty list.
 *
 * @param input - Team, event, and occurrence.
 * @returns The stored offers, or none.
 */
export const getCarpool = async (input: {
  teamId: string;
  eventId: string;
  occurrenceStartsAt: string;
}): Promise<CarpoolResponse> => {
  await requireTeam(input.teamId);
  const occurrenceIso = await requireOccurrence(input.teamId, input.eventId, input.occurrenceStartsAt);
  const item = await getItem<CarpoolItem>(teamPk(input.teamId), carpoolSk(occurrenceIso, input.eventId));
  return {
    eventId: input.eventId,
    occurrenceStartsAt: occurrenceIso,
    offers: (item?.offers ?? []).map(publicCarpoolOffer),
  };
};

/**
 * Creates, replaces, or removes the caller's offer. Riders who still fit stay.
 *
 * @param input - Team, event, occurrence, seat count, and the driver.
 * @returns The offers left on this date.
 */
export const putCarpoolOffer = async (input: {
  teamId: string;
  eventId: string;
  occurrenceStartsAt: string;
  seats: number;
  userId: string;
}): Promise<CarpoolResponse> => {
  await requireTeam(input.teamId);
  const occurrenceIso = await requireOccurrence(input.teamId, input.eventId, input.occurrenceStartsAt);
  const members = await memberIdsOf(input.teamId);
  if (!members.has(input.userId)) throw new Error('carpool_member_not_found');
  const item = await getItem<CarpoolItem>(teamPk(input.teamId), carpoolSk(occurrenceIso, input.eventId));
  const previous = item?.offers ?? [];
  const others = previous.filter((offer) => offer.userId !== input.userId);
  if (input.seats === 0) return writeCarpool(input.teamId, input.eventId, occurrenceIso, previous, others);
  const current = previous.find((offer) => offer.userId === input.userId);
  const riders = (current?.riderIds ?? []).filter((riderId) => riderId !== input.userId).slice(0, input.seats);
  if (riders.some((riderId) => !members.has(riderId))) throw new Error('carpool_member_not_found');
  return writeCarpool(input.teamId, input.eventId, occurrenceIso, previous, [
    ...others,
    { userId: input.userId, seats: input.seats, riderIds: riders, ...(current?.chatId !== undefined ? { chatId: current.chatId } : {}) },
  ]);
};

/**
 * Claims a free seat, or leaves that car when the caller is already in it.
 * A claim also removes the caller from every other car on this date.
 *
 * @param input - Team, event, occurrence, the driver, and the rider.
 * @returns The offers left on this date.
 */
export const claimCarpool = async (input: {
  teamId: string;
  eventId: string;
  occurrenceStartsAt: string;
  driverUserId: string;
  userId: string;
}): Promise<CarpoolResponse> => {
  await requireTeam(input.teamId);
  const occurrenceIso = await requireOccurrence(input.teamId, input.eventId, input.occurrenceStartsAt);
  if (input.driverUserId === input.userId) throw new Error('carpool_own_offer');
  const members = await memberIdsOf(input.teamId);
  if (!members.has(input.userId) || !members.has(input.driverUserId)) {
    throw new Error('carpool_member_not_found');
  }
  const item = await getItem<CarpoolItem>(teamPk(input.teamId), carpoolSk(occurrenceIso, input.eventId));
  const previous = item?.offers ?? [];
  const offer = previous.find((row) => row.userId === input.driverUserId);
  if (offer === undefined) throw new Error('carpool_offer_not_found');
  const leaving = offer.riderIds.includes(input.userId);
  if (!leaving && offer.riderIds.length >= offer.seats) throw new Error('carpool_full');
  const offers = previous.map((row) => {
    const without = row.riderIds.filter((riderId) => riderId !== input.userId);
    if (row.userId !== input.driverUserId) return { ...row, riderIds: without };
    return { ...row, riderIds: leaving ? without : [...without, input.userId] };
  });
  return writeCarpool(input.teamId, input.eventId, occurrenceIso, previous, offers);
};
