/**
 * Schedule store: events, edits, fixture locks, series dates, RSVPs, lineups,
 * and carpools.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryTable } from '../../lib/dynamo/memory-table.js';
import { TABLE_PK, TABLE_SK, carpoolSk, eventSk, teamMemberSk, teamMetaSk, teamPk } from '../../lib/dynamo/keys.js';

const { fanoutJobs } = vi.hoisted(() => ({ fanoutJobs: [] as Array<Record<string, unknown>> }));

vi.mock('../../lib/dynamo/access.js', async () => (await import('../../lib/dynamo/memory-table.js')).memoryAccess);

vi.mock('../../lib/fanout-enqueue.js', () => ({
  enqueueFanout: async (job: Record<string, unknown>): Promise<void> => {
    fanoutJobs.push(job);
  },
  resetFanoutSqsClient: (): void => undefined,
}));

const {
  cancelOccurrence,
  claimCarpool,
  createEvent,
  deleteEvent,
  detachFixtureId,
  getCarpool,
  getLineup,
  getPreviousLineup,
  listOccurrences,
  putCarpoolOffer,
  putLineup,
  requireMembership,
  requireTeam,
  saveOccurrenceException,
  updateEvent,
  upsertRsvp,
  writeEventFacts,
} = await import('./schedule-store.js');

const TEAM = 'hawks';
const START = '2026-11-07T18:00:00.000Z';
const END = '2026-11-07T20:00:00.000Z';
const WEEK_LATER = '2026-11-14T18:00:00.000Z';

const put = (sk: string, fields: Record<string, unknown>): void =>
  memoryTable.put({ [TABLE_PK]: teamPk(TEAM), [TABLE_SK]: sk, ...fields });

const event = (eventId: string, fields: Record<string, unknown> = {}): void =>
  put(eventSk(eventId), {
    eventId,
    teamId: TEAM,
    eventType: 'game',
    title: 'Game',
    startsAt: START,
    createdBy: 'admin',
    createdAt: START,
    updatedAt: START,
    ...fields,
  });

const stored = (eventId: string): Record<string, unknown> | undefined =>
  memoryTable.get(teamPk(TEAM), eventSk(eventId));

const weekly = { frequency: 'WEEKLY', interval: 1 } as const;

beforeEach(() => {
  memoryTable.clear();
  fanoutJobs.length = 0;
  put(teamMetaSk(), { teamId: TEAM, name: 'Hawks', timeZone: 'UTC', defaultChatId: 'chat', createdBy: 'admin', createdAt: START });
  for (const userId of ['admin', 'ann', 'ben', 'cal']) {
    put(teamMemberSk(userId), { userId, role: 'player', joinedAt: START });
  }
});

describe('team checks', () => {
  it('needs the team and a roster spot', async () => {
    await expect(requireTeam('nobody')).rejects.toThrow('team_not_found');
    await expect(requireMembership(TEAM, 'stranger')).rejects.toThrow('not_a_member');
    await expect(requireMembership(TEAM, 'ann')).resolves.toBeUndefined();
  });
});

describe('createEvent', () => {
  it('stores the venue, repeat, notes, and opponent of a game', async () => {
    const game = await createEvent({
      teamId: TEAM,
      userId: 'admin',
      body: {
        eventType: 'game',
        title: 'Opener',
        startsAt: START,
        endsAt: END,
        location: 'Away',
        latitude: 30,
        longitude: -97,
        recurrence: { ...weekly, until: '2026-12-01T00:00:00.000Z' },
        notes: 'Bring water',
        opponentName: 'Owls',
        side: 'home',
      },
    });
    expect(stored(game.eventId)).toMatchObject({
      endsAt: END,
      location: 'Away',
      latitude: 30,
      longitude: -97,
      notes: 'Bring water',
      opponentName: 'Owls',
      recurrence: { frequency: 'WEEKLY' },
    });
  });

  it('drops an opponent sent with a practice', async () => {
    const practice = await createEvent({
      teamId: TEAM,
      userId: 'admin',
      body: { eventType: 'practice', title: 'Drills', startsAt: START, opponentName: 'Owls' },
    });
    expect(practice).not.toHaveProperty('opponentName');
  });
});

describe('updateEvent', () => {
  it('locks every shared fact on a linked game and keeps its derived name', async () => {
    event('linked', { fixtureId: 'f1' });
    const locked = [
      { startsAt: WEEK_LATER },
      { endsAt: END },
      { location: 'Elsewhere' },
      { latitude: 1 },
      { longitude: 2 },
      { opponentName: 'Bears' },
      { side: 'away' as const },
      { eventType: 'game' as const },
      { recurrence: weekly },
    ];
    for (const body of locked) {
      await expect(updateEvent({ teamId: TEAM, eventId: 'linked', body })).rejects.toThrow('fixture_locked');
    }
    expect((await updateEvent({ teamId: TEAM, eventId: 'linked', body: { title: 'Derby' } })).title).toBe('Game');
  });

  it('refuses an opponent or side on anything but a game', async () => {
    event('practice', { eventType: 'practice' });
    await expect(updateEvent({ teamId: TEAM, eventId: 'practice', body: { opponentName: 'Owls' } })).rejects.toThrow(
      'not_a_game',
    );
    await expect(updateEvent({ teamId: TEAM, eventId: 'practice', body: { side: 'home' } })).rejects.toThrow(
      'not_a_game',
    );
  });

  it('sets and clears every optional field', async () => {
    event('g1', { opponentName: 'Owls', side: 'home', notes: 'Old', endsAt: END, location: 'Field' });
    const set = await updateEvent({
      teamId: TEAM,
      eventId: 'g1',
      body: {
        notes: 'New',
        location: 'New Field',
        endsAt: '2026-11-07T21:00:00.000Z',
        latitude: 1,
        longitude: 2,
        opponentName: 'Bears',
        side: 'away',
        recurrence: weekly,
      },
    });
    expect(set).toMatchObject({
      notes: 'New',
      location: 'New Field',
      endsAt: '2026-11-07T21:00:00.000Z',
      latitude: 1,
      longitude: 2,
      recurrence: weekly,
    });
    expect(stored('g1')).toMatchObject({ opponentName: 'Bears', side: 'away' });

    const halfCoordinate = await updateEvent({ teamId: TEAM, eventId: 'g1', body: { latitude: 9 } });
    expect(halfCoordinate.latitude).toBe(1);

    await updateEvent({
      teamId: TEAM,
      eventId: 'g1',
      body: {
        notes: null,
        opponentName: null,
        side: null,
        endsAt: null,
        location: null,
        latitude: null,
        recurrence: null,
        title: 'New title',
      },
    });
    // A game is named from its side and opponent, so a sent title is ignored.
    expect(stored('g1')?.title).toBe('Game');
    for (const field of ['notes', 'opponentName', 'side', 'endsAt', 'location', 'latitude', 'longitude', 'recurrence']) {
      expect(stored('g1')).not.toHaveProperty(field);
    }
  });

  it('drops the opponent and side when a game becomes a practice', async () => {
    event('g1', { opponentName: 'Owls', side: 'home' });
    await updateEvent({ teamId: TEAM, eventId: 'g1', body: { eventType: 'practice' } });
    expect(stored('g1')).not.toHaveProperty('opponentName');
    expect(stored('g1')).not.toHaveProperty('side');
  });

  it('reports a moved single date for an exception, and no single date for a series', async () => {
    event('series', { recurrence: weekly });
    event('exception', { seriesEventId: 'series', originalStartsAt: WEEK_LATER, startsAt: WEEK_LATER });
    await updateEvent({ teamId: TEAM, eventId: 'exception', body: { location: 'Field 2' } });
    await updateEvent({ teamId: TEAM, eventId: 'series', body: { location: 'Field 3' } });
    const moves = fanoutJobs.filter((job) => job.type === 'event_moved');
    expect(moves[0]).toMatchObject({ eventId: 'exception', occurrenceStartsAt: WEEK_LATER });
    expect(moves[1]).not.toHaveProperty('occurrenceStartsAt');
  });
});

describe('move notices', () => {
  it('tells the team only when the time or place changes', async () => {
    event('g1', { eventType: 'meeting', title: 'Meeting', location: 'Field 1' });
    await updateEvent({ teamId: TEAM, eventId: 'g1', body: { title: 'Renamed meeting' } });
    expect(fanoutJobs.some((job) => job.type === 'event_moved')).toBe(false);
    await updateEvent({ teamId: TEAM, eventId: 'g1', body: { location: 'Field 2' } });
    expect(fanoutJobs).toContainEqual(
      expect.objectContaining({ type: 'event_moved', change: 'location', title: 'Renamed meeting' }),
    );
  });
});

describe('fixture facts', () => {
  it('writes shared facts with or without a venue and leaves detached games alone', async () => {
    event('g1', { endsAt: END, location: 'Field', latitude: 1, longitude: 2, opponentName: 'Old' });
    const bare = await writeEventFacts(TEAM, 'g1', { startsAt: START });
    expect(bare).not.toHaveProperty('endsAt');
    expect(bare).not.toHaveProperty('location');
    expect(bare).not.toHaveProperty('latitude');
    expect(stored('g1')?.opponentName).toBe('Old');

    const full = await writeEventFacts(TEAM, 'g1', {
      startsAt: START,
      endsAt: END,
      location: 'Park',
      latitude: 3,
      longitude: 4,
      opponentName: 'Owls',
      side: 'away',
      fixtureId: 'f1',
    });
    expect(full).toMatchObject({ endsAt: END, location: 'Park', latitude: 3, longitude: 4 });
    expect(stored('g1')).toMatchObject({ opponentName: 'Owls', side: 'away', fixtureId: 'f1' });

    fanoutJobs.length = 0;
    event('free');
    await detachFixtureId(TEAM, 'free');
    expect(fanoutJobs).toEqual([]);
  });

  it('refuses to delete a series that has a linked date', async () => {
    event('series', { recurrence: weekly });
    event('exception', { seriesEventId: 'series', originalStartsAt: WEEK_LATER, fixtureId: 'f1' });
    await expect(deleteEvent(TEAM, 'series')).rejects.toThrow('fixture_linked');
  });
});

describe('single dates of a series', () => {
  it('cancels a date once, ignores a repeat, and refuses a date the series never has', async () => {
    event('series', { recurrence: weekly, eventType: 'practice' });
    await cancelOccurrence({ teamId: TEAM, eventId: 'series', occurrenceStartsAt: WEEK_LATER });
    await cancelOccurrence({ teamId: TEAM, eventId: 'series', occurrenceStartsAt: WEEK_LATER });
    expect(stored('series')?.exdates).toEqual([WEEK_LATER]);
    await expect(
      cancelOccurrence({ teamId: TEAM, eventId: 'series', occurrenceStartsAt: '2026-11-08T18:00:00.000Z' }),
    ).rejects.toThrow('occurrence_not_found');
  });

  it('inherits or clears the series venue on a one-date edit', async () => {
    event('series', {
      eventType: 'meeting',
      recurrence: weekly,
      endsAt: END,
      location: 'Field',
      notes: 'Shin guards',
      latitude: 1,
      longitude: 2,
    });
    const inherited = await saveOccurrenceException({
      teamId: TEAM,
      userId: 'admin',
      eventId: 'series',
      body: { occurrenceStartsAt: WEEK_LATER },
    });
    expect(inherited).toMatchObject({ endsAt: '2026-11-14T20:00:00.000Z', location: 'Field', notes: 'Shin guards', latitude: 1 });

    const cleared = await saveOccurrenceException({
      teamId: TEAM,
      userId: 'admin',
      eventId: 'series',
      body: { occurrenceStartsAt: '2026-11-21T18:00:00.000Z', endsAt: null, location: null, notes: null, latitude: null },
    });
    expect(cleared).not.toHaveProperty('endsAt');
    expect(cleared).not.toHaveProperty('location');
    expect(cleared).not.toHaveProperty('notes');
    expect(cleared).not.toHaveProperty('latitude');

    const replaced = await saveOccurrenceException({
      teamId: TEAM,
      userId: 'admin',
      eventId: 'series',
      body: {
        occurrenceStartsAt: '2026-11-28T18:00:00.000Z',
        endsAt: '2026-11-28T21:00:00.000Z',
        location: 'Park',
        notes: 'Cleats',
        latitude: 5,
        longitude: 6,
      },
    });
    expect(replaced).toMatchObject({ location: 'Park', notes: 'Cleats', latitude: 5, longitude: 6 });

    const again = await saveOccurrenceException({
      teamId: TEAM,
      userId: 'admin',
      eventId: 'series',
      body: { occurrenceStartsAt: WEEK_LATER, title: 'Moved again' },
    });
    expect(again.eventId).toBe(inherited.eventId);
    expect(again.title).toBe('Moved again');
  });

  it('starts a one-date edit with no end when the series has none, and refuses an end before the start', async () => {
    event('series', { recurrence: weekly });
    const open = await saveOccurrenceException({
      teamId: TEAM,
      userId: 'admin',
      eventId: 'series',
      body: { occurrenceStartsAt: WEEK_LATER },
    });
    expect(open).not.toHaveProperty('endsAt');
    await expect(
      saveOccurrenceException({
        teamId: TEAM,
        userId: 'admin',
        eventId: 'series',
        body: { occurrenceStartsAt: '2026-11-21T18:00:00.000Z', endsAt: '2026-11-21T17:00:00.000Z' },
      }),
    ).rejects.toThrow('invalid_ends_at');
  });
});

describe('series lifecycle', () => {
  it('cancels one date, edits one date, edits the series, and deletes it all', async () => {
    const created = await createEvent({
      teamId: TEAM,
      userId: 'admin',
      body: {
        eventType: 'meeting',
        title: 'Meeting',
        startsAt: '2026-09-02T17:00:00.000Z',
        endsAt: '2026-09-02T18:00:00.000Z',
        recurrence: { ...weekly, byWeekDay: ['WE'] },
      },
    });
    const from = '2026-09-01T00:00:00.000Z';
    const to = '2026-09-30T23:59:59.999Z';
    const starts = async () => (await listOccurrences(TEAM, from, to)).occurrences;

    await cancelOccurrence({ teamId: TEAM, eventId: created.eventId, occurrenceStartsAt: '2026-09-09T17:00:00.000Z' });
    expect((await starts()).map((row) => row.startsAt)).not.toContain('2026-09-09T17:00:00.000Z');
    expect(await starts()).toHaveLength(4);

    const exception = await saveOccurrenceException({
      teamId: TEAM,
      userId: 'admin',
      eventId: created.eventId,
      body: { occurrenceStartsAt: '2026-09-16T17:00:00.000Z', title: 'Moved meeting', startsAt: '2026-09-16T19:00:00.000Z' },
    });
    expect((await starts()).find((row) => row.eventId === exception.eventId)).toMatchObject({
      title: 'Moved meeting',
      startsAt: '2026-09-16T19:00:00.000Z',
      recurring: true,
      seriesEventId: created.eventId,
      originalStartsAt: '2026-09-16T17:00:00.000Z',
    });
    expect((await starts()).some((row) => row.startsAt === '2026-09-16T17:00:00.000Z')).toBe(false);

    await updateEvent({ teamId: TEAM, eventId: created.eventId, body: { title: 'Team meeting' } });
    const series = await starts();
    expect(series.find((row) => row.eventId === created.eventId)?.title).toBe('Team meeting');
    expect(series.find((row) => row.eventId === exception.eventId)?.title).toBe('Moved meeting');

    await deleteEvent(TEAM, exception.eventId);
    expect(await starts()).toEqual([]);
  });
});

describe('listOccurrences', () => {
  it('keeps the newest RSVP per person and carries the game details', async () => {
    event('g1', { notes: 'N', latitude: 1, longitude: 2, opponentName: 'Owls', side: 'home', fixtureId: 'f1' });
    await upsertRsvp({ teamId: TEAM, userId: 'ann', eventId: 'g1', occurrenceStartsAt: START, status: 'going' });
    put(`RSVP#${START}#g1#ann#old`, {
      eventId: 'g1',
      occurrenceStartsAt: START,
      userId: 'ann',
      status: 'not_going',
      updatedAt: '2000-01-01T00:00:00.000Z',
    });
    const [occurrence] = (await listOccurrences(TEAM, '2026-11-07T00:00:00.000Z', '2026-11-08T00:00:00.000Z')).occurrences;
    expect(occurrence).toMatchObject({ notes: 'N', latitude: 1, longitude: 2, opponentName: 'Owls', side: 'home', fixtureId: 'f1' });
    expect(occurrence?.rsvps).toEqual([{ userId: 'ann', status: 'going' }]);
  });
});

describe('lineups', () => {
  it('needs a real, uncancelled game date', async () => {
    event('practice', { eventType: 'practice' });
    event('series', { recurrence: weekly, exdates: [WEEK_LATER] });
    await expect(getLineup({ teamId: TEAM, eventId: 'practice', occurrenceStartsAt: START })).rejects.toThrow('not_a_game');
    await expect(getLineup({ teamId: TEAM, eventId: 'series', occurrenceStartsAt: WEEK_LATER })).rejects.toThrow(
      'occurrence_not_found',
    );
    expect((await getLineup({ teamId: TEAM, eventId: 'series', occurrenceStartsAt: START })).slots).toEqual([]);
  });

  it('copies the latest earlier lineup in the series, or starts empty', async () => {
    event('series', { recurrence: weekly });
    expect((await getPreviousLineup({ teamId: TEAM, eventId: 'series', occurrenceStartsAt: WEEK_LATER })).slots).toEqual([]);
    await expect(
      putLineup({ teamId: TEAM, eventId: 'series', occurrenceStartsAt: START, slots: [{ userId: 'nobody', position: 'GK' }] }),
    ).rejects.toThrow('lineup_member_not_found');
    await putLineup({ teamId: TEAM, eventId: 'series', occurrenceStartsAt: START, slots: [{ userId: 'ann', position: 'GK' }] });
    const previous = await getPreviousLineup({ teamId: TEAM, eventId: 'series', occurrenceStartsAt: WEEK_LATER });
    expect(previous).toMatchObject({ occurrenceStartsAt: START, slots: [{ userId: 'ann', position: 'GK' }] });
  });
});

describe('carpools', () => {
  const ride = { teamId: TEAM, eventId: 'g1', occurrenceStartsAt: START };

  beforeEach(() => event('g1', { eventType: 'practice' }));

  it('needs a real date and team members', async () => {
    await expect(getCarpool({ ...ride, occurrenceStartsAt: WEEK_LATER })).rejects.toThrow('occurrence_not_found');
    expect((await getCarpool(ride)).offers).toEqual([]);
    await expect(putCarpoolOffer({ ...ride, seats: 2, userId: 'stranger' })).rejects.toThrow('carpool_member_not_found');
  });

  it('keeps riders who still fit when a driver changes seats, and removes the car at zero', async () => {
    await putCarpoolOffer({ ...ride, seats: 3, userId: 'ann' });
    await claimCarpool({ ...ride, driverUserId: 'ann', userId: 'ben' });
    await claimCarpool({ ...ride, driverUserId: 'ann', userId: 'cal' });
    const fewer = await putCarpoolOffer({ ...ride, seats: 1, userId: 'ann' });
    expect(fewer.offers).toEqual([{ userId: 'ann', seats: 1, riderIds: ['ben'] }]);
    await putCarpoolOffer({ ...ride, seats: 0, userId: 'ann' });
    expect(memoryTable.get(teamPk(TEAM), carpoolSk(START, 'g1'))).toBeUndefined();
  });

  it('refuses a rider who has left the team', async () => {
    put(carpoolSk(START, 'g1'), { eventId: 'g1', teamId: TEAM, occurrenceStartsAt: START, offers: [{ userId: 'ann', seats: 2, riderIds: ['gone'] }] });
    await expect(putCarpoolOffer({ ...ride, seats: 2, userId: 'ann' })).rejects.toThrow('carpool_member_not_found');
  });

  it('turns away bad claims and lets a rider leave', async () => {
    await expect(claimCarpool({ ...ride, driverUserId: 'ann', userId: 'ann' })).rejects.toThrow('carpool_own_offer');
    await expect(claimCarpool({ ...ride, driverUserId: 'ann', userId: 'stranger' })).rejects.toThrow(
      'carpool_member_not_found',
    );
    await expect(claimCarpool({ ...ride, driverUserId: 'ann', userId: 'ben' })).rejects.toThrow('carpool_offer_not_found');
    await putCarpoolOffer({ ...ride, seats: 1, userId: 'ann' });
    await claimCarpool({ ...ride, driverUserId: 'ann', userId: 'ben' });
    await expect(claimCarpool({ ...ride, driverUserId: 'ann', userId: 'cal' })).rejects.toThrow('carpool_full');
    const left = await claimCarpool({ ...ride, driverUserId: 'ann', userId: 'ben' });
    expect(left.offers).toEqual([{ userId: 'ann', seats: 1, riderIds: [] }]);
  });
});
