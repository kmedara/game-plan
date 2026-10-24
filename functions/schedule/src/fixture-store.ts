/**
 * Shared games between two clubs.
 *
 * Each club keeps its own event. The fixture holds the start, the venue, and
 * the two names, plus the staff thread once both clubs have linked.
 */

import { randomUUID } from 'node:crypto';
import type { AcceptFixtureBody, ProposeFixtureBody, UpdateFixtureBody } from '@gameplan/schemas';
import { assertEventEndsAfterStart } from '@gameplan/rules';
import type { Fixture, FixtureList, GameSide } from '@gameplan/types';
import {
  assertCanManageEvents,
  dissolveFixtureChat,
  eventManagerIds,
  fixtureChatName,
  refreshFixtureChat,
  syncFixtureChat,
} from '../../lib/fixture-chat.js';
import {
  FIXTURE_INVITE_SK_PREFIX,
  FIXTURE_LINK_SK_PREFIX,
  TABLE_PK,
  TABLE_SK,
  deleteItem,
  fixtureInviteSk,
  fixtureLinkSk,
  fixtureMetaSk,
  fixturePk,
  getItem,
  putItem,
  queryBySkPrefix,
  teamMetaSk,
  teamPk,
} from '../../lib/dynamo/index.js';
import {
  attachFixtureId,
  createEvent,
  detachFixtureId,
  requireEvent,
  writeEventFacts,
  type EventItem,
  type SharedEventFacts,
} from './schedule-store.js';

/** Team metadata the fixture needs. */
type TeamRow = {
  teamId: string;
  name: string;
  sport?: string;
};

/** Shared game under `FIXTURE#id` / `META`. */
type FixtureItem = {
  PK: string;
  SK: string;
  fixtureId: string;
  startsAt: string;
  endsAt?: string;
  location?: string;
  latitude?: number;
  longitude?: number;
  homeName: string;
  awayName: string;
  homeTeamId?: string;
  awayTeamId?: string;
  homeEventId?: string;
  awayEventId?: string;
  status: 'proposed' | 'linked';
  chatId?: string;
  sport?: string;
  proposerTeamId: string;
  inviteeTeamId: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

/** One club's pointer at `TEAM#id` / `FIXTURE#fixtureId`. */
type FixtureLinkItem = {
  PK: string;
  SK: string;
  fixtureId: string;
  teamId: string;
  eventId?: string;
  side?: GameSide;
  status?: 'proposed' | 'linked';
  chatId?: string;
};

const opposite = (side: GameSide): GameSide => (side === 'home' ? 'away' : 'home');

const normalizedSport = (sport: string | undefined): string | undefined => {
  const value = sport?.trim().toLowerCase();
  return value === undefined || value.length === 0 ? undefined : value;
};

/**
 * Loads a team, or throws when it does not exist.
 *
 * @param teamId - The team id.
 * @returns The team name and sport.
 */
const requireTeamRow = async (teamId: string): Promise<TeamRow> => {
  const team = await getItem<TeamRow>(teamPk(teamId), teamMetaSk());
  if (team === undefined) throw new Error('team_not_found');
  return team;
};

/**
 * True when the caller holds `manage_events`. A missing membership is false.
 *
 * @param teamId - The team to check.
 * @param userId - The caller.
 * @returns Whether the caller can schedule for that club.
 */
const canManageEvents = async (teamId: string, userId: string): Promise<boolean> => {
  try {
    await assertCanManageEvents(teamId, userId);
    return true;
  } catch (error) {
    if (error instanceof Error && (error.message === 'not_a_member' || error.message === 'forbidden')) {
      return false;
    }
    throw error;
  }
};

const requireFixture = async (fixtureId: string): Promise<FixtureItem> => {
  const item = await getItem<FixtureItem>(fixturePk(fixtureId), fixtureMetaSk());
  if (item === undefined) throw new Error('fixture_not_found');
  return item;
};

/**
 * Maps a stored fixture to the wire payload.
 *
 * @param item - The fixture row.
 * @returns The public fixture.
 */
const toFixture = (item: FixtureItem): Fixture => ({
  fixtureId: item.fixtureId,
  status: item.status,
  startsAt: item.startsAt,
  ...(item.endsAt !== undefined ? { endsAt: item.endsAt } : {}),
  ...(item.location !== undefined ? { location: item.location } : {}),
  ...(item.latitude !== undefined ? { latitude: item.latitude } : {}),
  ...(item.longitude !== undefined ? { longitude: item.longitude } : {}),
  homeName: item.homeName,
  awayName: item.awayName,
  ...(item.homeTeamId !== undefined ? { homeTeamId: item.homeTeamId } : {}),
  ...(item.awayTeamId !== undefined ? { awayTeamId: item.awayTeamId } : {}),
  ...(item.homeEventId !== undefined ? { homeEventId: item.homeEventId } : {}),
  ...(item.awayEventId !== undefined ? { awayEventId: item.awayEventId } : {}),
  proposerTeamId: item.proposerTeamId,
  inviteeTeamId: item.inviteeTeamId,
  ...(item.sport !== undefined ? { sport: item.sport } : {}),
  ...(item.chatId !== undefined ? { chatId: item.chatId } : {}),
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});

/**
 * Applies an accept or patch body onto the fixture's start and venue.
 *
 * @param current - The stored fixture.
 * @param body - Fields the caller sent. Omitted fields stay.
 * @returns The next shared facts, without opponent or fixture id.
 */
const mergeFacts = (
  current: FixtureItem,
  body: AcceptFixtureBody | UpdateFixtureBody,
): Omit<SharedEventFacts, 'opponentName' | 'side' | 'fixtureId'> => {
  const startsAt = body.startsAt !== undefined ? new Date(body.startsAt).toISOString() : current.startsAt;
  let endsAt = current.endsAt;
  if (body.endsAt === null) endsAt = undefined;
  else if (body.endsAt !== undefined) endsAt = new Date(body.endsAt).toISOString();
  let location = current.location;
  if (body.location === null) location = undefined;
  else if (body.location !== undefined) location = body.location;
  let latitude = current.latitude;
  let longitude = current.longitude;
  if (body.latitude === null || body.longitude === null) {
    latitude = undefined;
    longitude = undefined;
  } else if (body.latitude !== undefined && body.longitude !== undefined) {
    latitude = body.latitude;
    longitude = body.longitude;
  }
  assertEventEndsAfterStart(startsAt, endsAt);
  return {
    startsAt,
    ...(endsAt !== undefined ? { endsAt } : {}),
    ...(location !== undefined ? { location } : {}),
    ...(latitude !== undefined && longitude !== undefined ? { latitude, longitude } : {}),
  };
};

const putFixture = async (item: FixtureItem): Promise<void> => {
  await putItem(item);
};

const putLink = async (input: {
  teamId: string;
  fixtureId: string;
  eventId?: string;
  side?: GameSide;
  status: 'proposed' | 'linked';
  chatId?: string;
}): Promise<void> => {
  await putItem({
    [TABLE_PK]: teamPk(input.teamId),
    [TABLE_SK]: fixtureLinkSk(input.fixtureId),
    fixtureId: input.fixtureId,
    teamId: input.teamId,
    ...(input.eventId !== undefined ? { eventId: input.eventId } : {}),
    ...(input.side !== undefined ? { side: input.side } : {}),
    status: input.status,
    ...(input.chatId !== undefined ? { chatId: input.chatId } : {}),
  });
};

const deleteLink = async (teamId: string, fixtureId: string): Promise<void> => {
  await deleteItem(teamPk(teamId), fixtureLinkSk(fixtureId));
};

const deleteInvite = async (teamId: string, fixtureId: string): Promise<void> => {
  await deleteItem(teamPk(teamId), fixtureInviteSk(fixtureId));
};

const assertShareable = (event: EventItem): GameSide => {
  if (event.eventType !== 'game') throw new Error('not_a_game');
  if (event.recurrence !== undefined || event.seriesEventId !== undefined) throw new Error('recurring_event');
  if (event.fixtureId !== undefined) throw new Error('fixture_exists');
  if (event.side === undefined) throw new Error('side_required');
  return event.side;
};

/**
 * Proposes one club's game to another club on GamePlan.
 *
 * @param input - The proposing club, the game, the caller, and the other club.
 * @returns The proposed fixture.
 */
export const proposeFixture = async (input: {
  teamId: string;
  eventId: string;
  userId: string;
  body: ProposeFixtureBody;
}): Promise<Fixture> => {
  await assertCanManageEvents(input.teamId, input.userId);
  if (input.body.teamId === input.teamId) throw new Error('same_team');
  const event = await requireEvent(input.teamId, input.eventId);
  const side = assertShareable(event);
  const proposer = await requireTeamRow(input.teamId);
  const invitee = await requireTeamRow(input.body.teamId);
  const proposerSport = normalizedSport(proposer.sport);
  const inviteeSport = normalizedSport(invitee.sport);
  if (proposerSport !== undefined && inviteeSport !== undefined && proposerSport !== inviteeSport) {
    throw new Error('sport_mismatch');
  }

  const otherName = event.opponentName ?? invitee.name;
  const now = new Date().toISOString();
  const fixtureId = randomUUID();
  const item: FixtureItem = {
    [TABLE_PK]: fixturePk(fixtureId),
    [TABLE_SK]: fixtureMetaSk(),
    fixtureId,
    startsAt: event.startsAt,
    ...(event.endsAt !== undefined ? { endsAt: event.endsAt } : {}),
    ...(event.location !== undefined ? { location: event.location } : {}),
    ...(event.latitude !== undefined && event.longitude !== undefined
      ? { latitude: event.latitude, longitude: event.longitude }
      : {}),
    homeName: side === 'home' ? proposer.name : otherName,
    awayName: side === 'away' ? proposer.name : otherName,
    ...(side === 'home' ? { homeTeamId: input.teamId, homeEventId: input.eventId } : {}),
    ...(side === 'away' ? { awayTeamId: input.teamId, awayEventId: input.eventId } : {}),
    status: 'proposed',
    ...(proposerSport !== undefined ? { sport: proposerSport } : {}),
    proposerTeamId: input.teamId,
    inviteeTeamId: input.body.teamId,
    createdBy: input.userId,
    createdAt: now,
    updatedAt: now,
  };
  await putFixture(item);
  await putLink({
    teamId: input.teamId,
    fixtureId,
    eventId: input.eventId,
    side,
    status: 'proposed',
  });
  await putItem({
    [TABLE_PK]: teamPk(input.body.teamId),
    [TABLE_SK]: fixtureInviteSk(fixtureId),
    fixtureId,
    teamId: input.body.teamId,
  });
  await attachFixtureId(input.teamId, input.eventId, fixtureId);
  return toFixture(item);
};

/**
 * Lists proposals and linked fixtures for one club.
 *
 * @param teamId - The team id.
 * @returns Incoming invites and this club's fixture links.
 */
export const listFixtures = async (teamId: string): Promise<FixtureList> => {
  const [links, invites] = await Promise.all([
    queryBySkPrefix<FixtureLinkItem>(teamPk(teamId), FIXTURE_LINK_SK_PREFIX),
    queryBySkPrefix<{ fixtureId?: string }>(teamPk(teamId), FIXTURE_INVITE_SK_PREFIX),
  ]);
  const ids = [
    ...new Set([
      ...links.map((link) => link.fixtureId),
      ...invites.flatMap((invite) => (typeof invite.fixtureId === 'string' ? [invite.fixtureId] : [])),
    ]),
  ];
  const fixtures: Fixture[] = [];
  for (const fixtureId of ids) {
    const item = await getItem<FixtureItem>(fixturePk(fixtureId), fixtureMetaSk());
    if (item !== undefined) fixtures.push(toFixture(item));
  }
  fixtures.sort((left, right) => left.startsAt.localeCompare(right.startsAt));
  return { teamId, fixtures };
};

const sideEventId = (item: FixtureItem, side: GameSide): string | undefined =>
  side === 'home' ? item.homeEventId : item.awayEventId;

/**
 * Accepts a proposal, creating or attaching the invitee's game.
 *
 * @param input - Fixture id, the invitee's admin or coach, and optional corrections.
 * @returns The linked fixture.
 */
export const acceptFixture = async (input: {
  fixtureId: string;
  userId: string;
  body: AcceptFixtureBody;
}): Promise<Fixture> => {
  const current = await requireFixture(input.fixtureId);
  if (current.status !== 'proposed') throw new Error('fixture_not_proposed');
  await assertCanManageEvents(current.inviteeTeamId, input.userId);
  const facts = mergeFacts(current, input.body);
  const proposerSide: GameSide = current.homeTeamId === current.proposerTeamId ? 'home' : 'away';
  const inviteeSide = opposite(proposerSide);
  const proposer = await requireTeamRow(current.proposerTeamId);
  const invitee = await requireTeamRow(current.inviteeTeamId);
  const proposerEventId = sideEventId(current, proposerSide);
  if (proposerEventId === undefined) throw new Error('event_not_found');

  let inviteeEventId = input.body.eventId;
  if (inviteeEventId === undefined) {
    const created = await createEvent({
      teamId: current.inviteeTeamId,
      userId: input.userId,
      body: {
        eventType: 'game',
        startsAt: facts.startsAt,
        ...(facts.endsAt !== undefined ? { endsAt: facts.endsAt } : {}),
        ...(facts.location !== undefined ? { location: facts.location } : {}),
        ...(facts.latitude !== undefined && facts.longitude !== undefined
          ? { latitude: facts.latitude, longitude: facts.longitude }
          : {}),
        opponentName: proposer.name,
        side: inviteeSide,
      },
    });
    inviteeEventId = created.eventId;
  } else {
    const existing = await requireEvent(current.inviteeTeamId, inviteeEventId);
    if (existing.eventType !== 'game') throw new Error('not_a_game');
    if (existing.recurrence !== undefined || existing.seriesEventId !== undefined) {
      throw new Error('recurring_event');
    }
    if (existing.fixtureId !== undefined) throw new Error('event_already_linked');
  }

  const homeName = proposerSide === 'home' ? proposer.name : invitee.name;
  const awayName = proposerSide === 'away' ? proposer.name : invitee.name;
  const homeTeamId = proposerSide === 'home' ? current.proposerTeamId : current.inviteeTeamId;
  const awayTeamId = proposerSide === 'away' ? current.proposerTeamId : current.inviteeTeamId;
  const homeEventId = proposerSide === 'home' ? proposerEventId : inviteeEventId;
  const awayEventId = proposerSide === 'away' ? proposerEventId : inviteeEventId;
  const chatId = randomUUID();
  const memberIds = [...new Set([...(await eventManagerIds(homeTeamId)), ...(await eventManagerIds(awayTeamId))])];
  await syncFixtureChat({
    chatId,
    name: fixtureChatName(homeName, awayName),
    createdBy: input.userId,
    memberIds,
  });

  await writeEventFacts(current.proposerTeamId, proposerEventId, {
    ...facts,
    opponentName: invitee.name,
    side: proposerSide,
    fixtureId: current.fixtureId,
  });
  await writeEventFacts(current.inviteeTeamId, inviteeEventId, {
    ...facts,
    opponentName: proposer.name,
    side: inviteeSide,
    fixtureId: current.fixtureId,
  });

  const now = new Date().toISOString();
  const next: FixtureItem = {
    ...current,
    ...facts,
    homeName,
    awayName,
    homeTeamId,
    awayTeamId,
    homeEventId,
    awayEventId,
    status: 'linked',
    chatId,
    updatedAt: now,
  };
  if (facts.endsAt === undefined) delete next.endsAt;
  if (facts.location === undefined) delete next.location;
  if (facts.latitude === undefined) {
    delete next.latitude;
    delete next.longitude;
  }
  await putFixture(next);
  await putLink({
    teamId: homeTeamId,
    fixtureId: current.fixtureId,
    eventId: homeEventId,
    side: 'home',
    status: 'linked',
    chatId,
  });
  await putLink({
    teamId: awayTeamId,
    fixtureId: current.fixtureId,
    eventId: awayEventId,
    side: 'away',
    status: 'linked',
    chatId,
  });
  await deleteInvite(current.inviteeTeamId, current.fixtureId);
  return toFixture(next);
};

/**
 * Drops a proposal. The proposer's game stays on their calendar.
 *
 * @param input - Fixture id and a staff member of either club.
 */
export const declineFixture = async (input: { fixtureId: string; userId: string }): Promise<void> => {
  const current = await requireFixture(input.fixtureId);
  if (current.status !== 'proposed') throw new Error('fixture_not_proposed');
  const proposerStaff = await canManageEvents(current.proposerTeamId, input.userId);
  const inviteeStaff = await canManageEvents(current.inviteeTeamId, input.userId);
  if (!proposerStaff && !inviteeStaff) throw new Error('forbidden');
  const proposerSide: GameSide = current.homeTeamId === current.proposerTeamId ? 'home' : 'away';
  const eventId = sideEventId(current, proposerSide);
  if (eventId !== undefined) await detachFixtureId(current.proposerTeamId, eventId);
  await deleteLink(current.proposerTeamId, current.fixtureId);
  await deleteInvite(current.inviteeTeamId, current.fixtureId);
  await deleteItem(fixturePk(current.fixtureId), fixtureMetaSk());
};

/**
 * Changes the shared start or venue and writes it onto each linked game.
 *
 * @param input - Fixture id, a staff member, and the fields to change.
 * @returns The updated fixture.
 */
export const updateFixture = async (input: {
  fixtureId: string;
  userId: string;
  body: UpdateFixtureBody;
}): Promise<Fixture> => {
  const current = await requireFixture(input.fixtureId);
  const allowed =
    current.status === 'proposed'
      ? await canManageEvents(current.proposerTeamId, input.userId)
      : (current.homeTeamId !== undefined && (await canManageEvents(current.homeTeamId, input.userId))) ||
        (current.awayTeamId !== undefined && (await canManageEvents(current.awayTeamId, input.userId)));
  if (!allowed) throw new Error('forbidden');
  const facts = mergeFacts(current, input.body);
  const now = new Date().toISOString();
  const next: FixtureItem = { ...current, ...facts, updatedAt: now };
  if (facts.endsAt === undefined) delete next.endsAt;
  if (facts.location === undefined) delete next.location;
  if (facts.latitude === undefined) {
    delete next.latitude;
    delete next.longitude;
  }
  await putFixture(next);

  const writeSide = async (side: GameSide, teamId: string | undefined, eventId: string | undefined): Promise<void> => {
    if (teamId === undefined || eventId === undefined) return;
    const opponentName = side === 'home' ? next.awayName : next.homeName;
    await writeEventFacts(teamId, eventId, { ...facts, opponentName, side, fixtureId: current.fixtureId });
  };
  await writeSide('home', next.homeTeamId, next.homeEventId);
  await writeSide('away', next.awayTeamId, next.awayEventId);
  if (next.status === 'linked') await refreshFixtureChat(next);
  return toFixture(next);
};

/**
 * Separates the two games. Each club keeps the last start, venue, and opponent name.
 *
 * @param input - Fixture id and a staff member of either club.
 */
export const unlinkFixture = async (input: { fixtureId: string; userId: string }): Promise<void> => {
  const current = await requireFixture(input.fixtureId);
  if (current.status !== 'linked') throw new Error('fixture_not_linked');
  const homeStaff = current.homeTeamId !== undefined && (await canManageEvents(current.homeTeamId, input.userId));
  const awayStaff = current.awayTeamId !== undefined && (await canManageEvents(current.awayTeamId, input.userId));
  if (!homeStaff && !awayStaff) throw new Error('forbidden');
  if (current.homeTeamId !== undefined && current.homeEventId !== undefined) {
    await detachFixtureId(current.homeTeamId, current.homeEventId);
  }
  if (current.awayTeamId !== undefined && current.awayEventId !== undefined) {
    await detachFixtureId(current.awayTeamId, current.awayEventId);
  }
  if (current.chatId !== undefined) await dissolveFixtureChat(current.chatId);
  if (current.homeTeamId !== undefined) await deleteLink(current.homeTeamId, current.fixtureId);
  if (current.awayTeamId !== undefined) await deleteLink(current.awayTeamId, current.fixtureId);
  await deleteItem(fixturePk(current.fixtureId), fixtureMetaSk());
};
