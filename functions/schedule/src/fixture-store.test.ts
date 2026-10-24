/**
 * Shared games between two clubs: propose, accept, decline, update, and unlink.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryTable } from '../../lib/dynamo/memory-table.js';
import {
  TABLE_PK,
  TABLE_SK,
  chatMetaSk,
  chatPk,
  eventSk,
  fixtureInviteSk,
  fixtureLinkSk,
  fixtureMetaSk,
  fixturePk,
  teamMemberSk,
  teamMetaSk,
  teamPk,
} from '../../lib/dynamo/keys.js';

vi.mock('../../lib/dynamo/access.js', async () => (await import('../../lib/dynamo/memory-table.js')).memoryAccess);

vi.mock('../../lib/fanout-enqueue.js', () => ({
  enqueueFanout: async (): Promise<void> => undefined,
  resetFanoutSqsClient: (): void => undefined,
}));

const { acceptFixture, declineFixture, listFixtures, proposeFixture, unlinkFixture, updateFixture } = await import(
  './fixture-store.js'
);

const START = '2026-11-07T18:00:00.000Z';
const END = '2026-11-07T20:00:00.000Z';

const put = (pk: string, sk: string, fields: Record<string, unknown>): void =>
  memoryTable.put({ [TABLE_PK]: pk, [TABLE_SK]: sk, ...fields });

const team = (teamId: string, name: string, sport?: string): void =>
  put(teamPk(teamId), teamMetaSk(), {
    teamId,
    name,
    timeZone: 'UTC',
    defaultChatId: `chat-${teamId}`,
    createdBy: 'seed',
    createdAt: START,
    ...(sport !== undefined ? { sport } : {}),
  });

/** Staff are team admins, the only role with `manage_events` by default. */
const staff = (teamId: string, userId: string, role = 'team_admin'): void =>
  put(teamPk(teamId), teamMemberSk(userId), { userId, role, joinedAt: START });

const game = (teamId: string, eventId: string, fields: Record<string, unknown> = {}): void =>
  put(teamPk(teamId), eventSk(eventId), {
    eventId,
    teamId,
    eventType: 'game',
    title: 'Game',
    startsAt: START,
    side: 'home',
    createdBy: 'seed',
    createdAt: START,
    updatedAt: START,
    ...fields,
  });

const event = (teamId: string, eventId: string): Record<string, unknown> | undefined =>
  memoryTable.get(teamPk(teamId), eventSk(eventId));

const fixtureRow = (fixtureId: string): Record<string, unknown> | undefined =>
  memoryTable.get(fixturePk(fixtureId), fixtureMetaSk());

/** Hawks (home) and Owls with one coach each, plus a Hawks player. */
const clubs = (): void => {
  team('hawks', 'Hawks', 'Soccer');
  team('owls', 'Owls', 'soccer ');
  staff('hawks', 'coach-h');
  staff('hawks', 'player-h', 'player');
  staff('owls', 'coach-o');
};

const propose = (eventId = 'g1', fields: Record<string, unknown> = {}) => {
  game('hawks', eventId, fields);
  return proposeFixture({ teamId: 'hawks', eventId, userId: 'coach-h', body: { teamId: 'owls' } });
};

describe('proposeFixture', () => {
  beforeEach(() => {
    memoryTable.clear();
    clubs();
  });

  it('refuses games that cannot be shared', async () => {
    const attempt = (eventId: string, fields: Record<string, unknown>, teamId = 'owls') => {
      game('hawks', eventId, fields);
      return proposeFixture({ teamId: 'hawks', eventId, userId: 'coach-h', body: { teamId } });
    };
    await expect(attempt('same', {}, 'hawks')).rejects.toThrow('same_team');
    await expect(attempt('practice', { eventType: 'practice' })).rejects.toThrow('not_a_game');
    await expect(attempt('weekly', { recurrence: { frequency: 'WEEKLY' } })).rejects.toThrow('recurring_event');
    await expect(attempt('moved', { seriesEventId: 'series' })).rejects.toThrow('recurring_event');
    await expect(attempt('linked', { fixtureId: 'f0' })).rejects.toThrow('fixture_exists');
    await expect(attempt('sideless', { side: undefined })).rejects.toThrow('side_required');
    await expect(attempt('ghost', {}, 'nobody')).rejects.toThrow('team_not_found');
    team('bears', 'Bears', 'hockey');
    await expect(attempt('hockey', {}, 'bears')).rejects.toThrow('sport_mismatch');
    await expect(
      proposeFixture({ teamId: 'hawks', eventId: 'g', userId: 'player-h', body: { teamId: 'owls' } }),
    ).rejects.toThrow('forbidden');
  });

  it('copies the venue and names the invitee when the game has no opponent', async () => {
    const fixture = await propose('g1', { endsAt: END, location: 'Field 1', latitude: 30, longitude: -97 });
    expect(fixture).toMatchObject({
      status: 'proposed',
      homeName: 'Hawks',
      awayName: 'Owls',
      homeTeamId: 'hawks',
      homeEventId: 'g1',
      endsAt: END,
      location: 'Field 1',
      latitude: 30,
      longitude: -97,
      sport: 'soccer',
    });
    expect(event('hawks', 'g1')?.fixtureId).toBe(fixture.fixtureId);
    expect(memoryTable.get(teamPk('owls'), fixtureInviteSk(fixture.fixtureId))).toBeDefined();
  });

  it('keeps a typed opponent name for an away game and skips the sport for clubs without one', async () => {
    team('hawks', 'Hawks');
    const fixture = await propose('g2', { side: 'away', opponentName: 'Owls FC', latitude: 30 });
    expect(fixture).toMatchObject({ homeName: 'Owls FC', awayName: 'Hawks', awayTeamId: 'hawks' });
    expect(fixture).not.toHaveProperty('sport');
    expect(fixture).not.toHaveProperty('latitude');
  });
});

describe('listFixtures', () => {
  beforeEach(() => {
    memoryTable.clear();
    clubs();
  });

  it('lists links and invites by start, skipping fixtures that are gone', async () => {
    const later = await propose('late', { startsAt: '2026-12-01T18:00:00.000Z' });
    const sooner = await propose('soon');
    put(teamPk('owls'), fixtureInviteSk('missing'), { fixtureId: 'missing' });
    put(teamPk('owls'), fixtureInviteSk('broken'), {});

    expect((await listFixtures('hawks')).fixtures.map((row) => row.fixtureId)).toEqual([
      sooner.fixtureId,
      later.fixtureId,
    ]);
    expect((await listFixtures('owls')).fixtures).toHaveLength(2);
  });
});

describe('acceptFixture', () => {
  beforeEach(() => {
    memoryTable.clear();
    clubs();
  });

  it('creates the away game, applies corrections, and opens the staff thread', async () => {
    const proposed = await propose('g1', { endsAt: END, location: 'Field 1', latitude: 30, longitude: -97 });
    const linked = await acceptFixture({
      fixtureId: proposed.fixtureId,
      userId: 'coach-o',
      body: { endsAt: null, location: null, latitude: null },
    });

    expect(linked).toMatchObject({ status: 'linked', awayTeamId: 'owls', homeName: 'Hawks', awayName: 'Owls' });
    expect(linked).not.toHaveProperty('endsAt');
    expect(linked).not.toHaveProperty('location');
    expect(linked).not.toHaveProperty('latitude');
    const awayGame = event('owls', linked.awayEventId ?? '');
    expect(awayGame).toMatchObject({ title: 'Away vs Hawks', side: 'away', fixtureId: proposed.fixtureId });
    expect(memoryTable.get(chatPk(linked.chatId ?? ''), chatMetaSk())?.name).toBe('Hawks vs Owls');
    expect(memoryTable.get(teamPk('owls'), fixtureInviteSk(proposed.fixtureId))).toBeUndefined();
    await expect(
      acceptFixture({ fixtureId: proposed.fixtureId, userId: 'coach-o', body: {} }),
    ).rejects.toThrow('fixture_not_proposed');
  });

  it('creates a home game with the full venue when the proposer plays away', async () => {
    const proposed = await propose('g1', { side: 'away' });
    const linked = await acceptFixture({
      fixtureId: proposed.fixtureId,
      userId: 'coach-o',
      body: { startsAt: START, endsAt: END, location: 'Owl Park', latitude: 1, longitude: 2 },
    });
    expect(event('owls', linked.homeEventId ?? '')).toMatchObject({
      title: 'Home vs Hawks',
      endsAt: END,
      location: 'Owl Park',
      latitude: 1,
      longitude: 2,
    });
  });

  it('attaches an existing game only when it can be linked', async () => {
    const proposed = await propose();
    const accept = (eventId: string) =>
      acceptFixture({ fixtureId: proposed.fixtureId, userId: 'coach-o', body: { eventId } });
    game('owls', 'practice', { eventType: 'practice' });
    game('owls', 'weekly', { recurrence: { frequency: 'WEEKLY' } });
    game('owls', 'moved', { seriesEventId: 'series' });
    game('owls', 'taken', { fixtureId: 'other' });
    game('owls', 'ours', { side: 'away' });
    await expect(accept('practice')).rejects.toThrow('not_a_game');
    await expect(accept('weekly')).rejects.toThrow('recurring_event');
    await expect(accept('moved')).rejects.toThrow('recurring_event');
    await expect(accept('taken')).rejects.toThrow('event_already_linked');
    expect((await accept('ours')).awayEventId).toBe('ours');
  });

  it('fails when the fixture or the proposer game is missing', async () => {
    await expect(acceptFixture({ fixtureId: 'none', userId: 'coach-o', body: {} })).rejects.toThrow(
      'fixture_not_found',
    );
    const proposed = await propose();
    put(fixturePk(proposed.fixtureId), fixtureMetaSk(), { ...fixtureRow(proposed.fixtureId), homeEventId: undefined });
    await expect(acceptFixture({ fixtureId: proposed.fixtureId, userId: 'coach-o', body: {} })).rejects.toThrow(
      'event_not_found',
    );
  });
});

describe('declineFixture', () => {
  beforeEach(() => {
    memoryTable.clear();
    clubs();
  });

  it('lets staff of either club drop a proposal and frees the proposer game', async () => {
    const first = await propose('g1');
    await declineFixture({ fixtureId: first.fixtureId, userId: 'coach-o' });
    expect(fixtureRow(first.fixtureId)).toBeUndefined();
    expect(event('hawks', 'g1')?.fixtureId).toBeUndefined();
    expect(memoryTable.get(teamPk('hawks'), fixtureLinkSk(first.fixtureId))).toBeUndefined();

    const second = await propose('g2', { side: 'away' });
    await declineFixture({ fixtureId: second.fixtureId, userId: 'coach-h' });
    expect(fixtureRow(second.fixtureId)).toBeUndefined();
  });

  it('refuses outsiders, linked fixtures, and copes with a missing game id', async () => {
    const proposed = await propose();
    await expect(declineFixture({ fixtureId: proposed.fixtureId, userId: 'player-h' })).rejects.toThrow('forbidden');
    put(fixturePk(proposed.fixtureId), fixtureMetaSk(), { ...fixtureRow(proposed.fixtureId), homeEventId: undefined });
    await declineFixture({ fixtureId: proposed.fixtureId, userId: 'coach-h' });
    expect(fixtureRow(proposed.fixtureId)).toBeUndefined();

    const linked = await propose('g3');
    await acceptFixture({ fixtureId: linked.fixtureId, userId: 'coach-o', body: {} });
    await expect(declineFixture({ fixtureId: linked.fixtureId, userId: 'coach-h' })).rejects.toThrow(
      'fixture_not_proposed',
    );
  });
});

describe('updateFixture', () => {
  beforeEach(() => {
    memoryTable.clear();
    clubs();
  });

  it('lets only the proposer change a proposal', async () => {
    const proposed = await propose('g1', { endsAt: END, location: 'Field 1', latitude: 30, longitude: -97 });
    await expect(
      updateFixture({ fixtureId: proposed.fixtureId, userId: 'coach-o', body: { location: 'Elsewhere' } }),
    ).rejects.toThrow('forbidden');
    const updated = await updateFixture({
      fixtureId: proposed.fixtureId,
      userId: 'coach-h',
      body: { endsAt: null, location: null, longitude: null },
    });
    expect(updated).not.toHaveProperty('endsAt');
    expect(updated).not.toHaveProperty('location');
    expect(updated).not.toHaveProperty('latitude');
    expect(event('hawks', 'g1')).not.toHaveProperty('location');
  });

  it('lets staff of either linked club move the game for both sides', async () => {
    const proposed = await propose();
    const linked = await acceptFixture({ fixtureId: proposed.fixtureId, userId: 'coach-o', body: {} });
    const moved = await updateFixture({
      fixtureId: linked.fixtureId,
      userId: 'coach-o',
      body: { startsAt: '2026-11-08T18:00:00.000Z', location: 'New Field', latitude: 5, longitude: 6 },
    });
    expect(moved).toMatchObject({ location: 'New Field', latitude: 5, longitude: 6 });
    expect(event('hawks', 'g1')).toMatchObject({ location: 'New Field', opponentName: 'Owls' });
    expect(event('owls', linked.awayEventId ?? '')).toMatchObject({ location: 'New Field', opponentName: 'Hawks' });
    await expect(
      updateFixture({ fixtureId: linked.fixtureId, userId: 'player-h', body: { location: 'X' } }),
    ).rejects.toThrow('forbidden');
  });

  it('skips a side that has no team or game on record', async () => {
    const proposed = await propose();
    const linked = await acceptFixture({ fixtureId: proposed.fixtureId, userId: 'coach-o', body: {} });
    put(fixturePk(linked.fixtureId), fixtureMetaSk(), {
      ...fixtureRow(linked.fixtureId),
      homeTeamId: undefined,
      awayEventId: undefined,
    });
    const updated = await updateFixture({ fixtureId: linked.fixtureId, userId: 'coach-o', body: { location: 'Y' } });
    expect(updated.location).toBe('Y');
    expect(event('hawks', 'g1')?.location).toBeUndefined();
  });
});

describe('unlinkFixture', () => {
  beforeEach(() => {
    memoryTable.clear();
    clubs();
  });

  it('separates the games, closes the thread, and removes both links', async () => {
    const proposed = await propose();
    const linked = await acceptFixture({ fixtureId: proposed.fixtureId, userId: 'coach-o', body: {} });
    await expect(unlinkFixture({ fixtureId: proposed.fixtureId, userId: 'player-h' })).rejects.toThrow('forbidden');
    await unlinkFixture({ fixtureId: linked.fixtureId, userId: 'coach-h' });

    expect(fixtureRow(linked.fixtureId)).toBeUndefined();
    expect(event('hawks', 'g1')?.fixtureId).toBeUndefined();
    expect(event('owls', linked.awayEventId ?? '')?.fixtureId).toBeUndefined();
    expect(memoryTable.get(chatPk(linked.chatId ?? ''), chatMetaSk())).toBeUndefined();
    expect(memoryTable.get(teamPk('owls'), fixtureLinkSk(linked.fixtureId))).toBeUndefined();
  });

  it('refuses a proposal and copes with a fixture missing one side', async () => {
    const proposed = await propose();
    await expect(unlinkFixture({ fixtureId: proposed.fixtureId, userId: 'coach-h' })).rejects.toThrow(
      'fixture_not_linked',
    );
    put(fixturePk('half'), fixtureMetaSk(), {
      fixtureId: 'half',
      status: 'linked',
      startsAt: START,
      homeName: 'Hawks',
      awayName: 'Owls',
      awayTeamId: 'owls',
      proposerTeamId: 'owls',
      inviteeTeamId: 'hawks',
    });
    await unlinkFixture({ fixtureId: 'half', userId: 'coach-o' });
    expect(fixtureRow('half')).toBeUndefined();
  });
});
