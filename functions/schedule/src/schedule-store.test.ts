/**
 * Schedule store coverage for update paths and membership checks.
 */

import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TABLE_PK, TABLE_SK, eventSk, teamMemberSk, teamMetaSk, teamPk } from '../../lib/dynamo/keys.js';

const store = new Map<string, Record<string, unknown>>();
const itemKey = (pk: string, sk: string): string => `${pk}\0${sk}`;

vi.mock('../../lib/fanout-enqueue.js', () => ({
  enqueueFanout: async (): Promise<void> => undefined,
  resetFanoutSqsClient: (): void => undefined,
}));

vi.mock('../../lib/dynamo/access.js', () => ({
  getItem: async <T extends Record<string, unknown>>(pk: string, sk: string) =>
    store.get(itemKey(pk, sk)) as T | undefined,
  putItem: async (item: Record<string, unknown>): Promise<void> => {
    store.set(itemKey(String(item[TABLE_PK]), String(item[TABLE_SK])), item);
  },
  deleteItem: async (): Promise<void> => undefined,
  transactWrite: async (): Promise<void> => undefined,
  queryBySkPrefix: async <T extends Record<string, unknown>>(pk: string, skPrefix: string) => {
    const items: T[] = [];
    for (const [key, item] of store) {
      const [itemPk, itemSk] = key.split('\0');
      if (itemPk === pk && itemSk.startsWith(skPrefix)) items.push(item as T);
    }
    return items;
  },
  queryBySkBetween: async () => [],
  queryAll: async () => [],
  queryPage: async () => ({ items: [] }),
  queryPartition: async () => [],
  encodeCursor: () => undefined,
  decodeCursor: () => undefined,
}));

const { createEvent, listOccurrences, requireMembership, requireTeam, updateEvent } = await import(
  './schedule-store.js',
);

describe('schedule-store', () => {
  beforeEach(() => store.clear());
  afterEach(() => store.clear());

  it('requireTeam throws when team metadata is missing', async () => {
    await expect(requireTeam(randomUUID())).rejects.toThrow('team_not_found');
  });

  it('requireMembership throws when the user is not on the roster', async () => {
    const teamId = randomUUID();
    store.set(itemKey(teamPk(teamId), teamMetaSk()), {
      [TABLE_PK]: teamPk(teamId),
      [TABLE_SK]: teamMetaSk(),
      teamId,
      name: 'Hawks',
      timeZone: 'UTC',
      defaultChatId: randomUUID(),
      createdBy: randomUUID(),
      createdAt: new Date().toISOString(),
    });
    await expect(requireMembership(teamId, randomUUID())).rejects.toThrow('not_a_member');
  });

  it('updateEvent clears optional fields and updates coordinates', async () => {
    const teamId = randomUUID();
    const eventId = randomUUID();
    store.set(itemKey(teamPk(teamId), teamMetaSk()), {
      [TABLE_PK]: teamPk(teamId),
      [TABLE_SK]: teamMetaSk(),
      teamId,
      name: 'Hawks',
      timeZone: 'UTC',
      defaultChatId: randomUUID(),
      createdBy: 'admin',
      createdAt: new Date().toISOString(),
    });
    store.set(itemKey(teamPk(teamId), eventSk(eventId)), {
      [TABLE_PK]: teamPk(teamId),
      [TABLE_SK]: eventSk(eventId),
      eventId,
      teamId,
      eventType: 'practice',
      title: 'Old',
      startsAt: '2026-09-01T12:00:00.000Z',
      endsAt: '2026-09-01T13:00:00.000Z',
      location: 'Field',
      latitude: 1,
      longitude: 2,
      recurrence: { frequency: 'WEEKLY', interval: 1 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    store.set(itemKey(teamPk(teamId), teamMemberSk('admin')), {
      [TABLE_PK]: teamPk(teamId),
      [TABLE_SK]: teamMemberSk('admin'),
      userId: 'admin',
      role: 'team_admin',
      joinedAt: new Date().toISOString(),
    });

    const updated = await updateEvent({
      teamId,
      eventId,
      body: {
        endsAt: null,
        location: null,
        latitude: null,
        longitude: null,
        recurrence: null,
        title: 'New title',
      },
    });
    expect(updated.title).toBe('New title');
    expect(updated.endsAt).toBeUndefined();
    expect(updated.location).toBeUndefined();
    expect(updated.latitude).toBeUndefined();
    expect(updated.longitude).toBeUndefined();
    expect(updated.recurrence).toBeUndefined();
  });

  it('updateEvent sets location when provided and listOccurrences omits endsAt', async () => {
    const teamId = randomUUID();
    const eventId = randomUUID();
    const openEndedId = randomUUID();
    store.set(itemKey(teamPk(teamId), teamMetaSk()), {
      [TABLE_PK]: teamPk(teamId),
      [TABLE_SK]: teamMetaSk(),
      teamId,
      name: 'Hawks',
      timeZone: 'UTC',
      defaultChatId: randomUUID(),
      createdBy: 'admin',
      createdAt: new Date().toISOString(),
    });
    store.set(itemKey(teamPk(teamId), eventSk(eventId)), {
      [TABLE_PK]: teamPk(teamId),
      [TABLE_SK]: eventSk(eventId),
      eventId,
      teamId,
      eventType: 'practice',
      title: 'Solo',
      startsAt: '2026-09-01T12:00:00.000Z',
      location: 'Home Field',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    store.set(itemKey(teamPk(teamId), eventSk(openEndedId)), {
      [TABLE_PK]: teamPk(teamId),
      [TABLE_SK]: eventSk(openEndedId),
      eventId: openEndedId,
      teamId,
      eventType: 'practice',
      title: 'Open',
      startsAt: '2026-09-01T16:00:00.000Z',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    store.set(itemKey(teamPk(teamId), teamMemberSk('admin')), {
      [TABLE_PK]: teamPk(teamId),
      [TABLE_SK]: teamMemberSk('admin'),
      userId: 'admin',
      role: 'team_admin',
      joinedAt: new Date().toISOString(),
    });

    const updated = await updateEvent({
      teamId,
      eventId,
      body: { location: 'New Field' },
    });
    expect(updated.location).toBe('New Field');

    const withEnds = await updateEvent({
      teamId,
      eventId,
      body: { endsAt: '2026-09-01T14:00:00.000Z' },
    });
    expect(withEnds.endsAt).toBe('2026-09-01T14:00:00.000Z');

    const schedule = await listOccurrences(
      teamId,
      new Date('2026-09-01T00:00:00.000Z'),
      new Date('2026-09-02T00:00:00.000Z'),
    );
    const withEndsAt = schedule.occurrences.find((row) => row.eventId === eventId);
    const withoutEndsAt = schedule.occurrences.find((row) => row.eventId === openEndedId);
    expect(withEndsAt?.endsAt).toBe('2026-09-01T14:00:00.000Z');
    expect(withEndsAt?.location).toBe('New Field');
    expect(withoutEndsAt?.endsAt).toBeUndefined();
  });

  it('createEvent writes a row under the team partition', async () => {
    const teamId = randomUUID();
    store.set(itemKey(teamPk(teamId), teamMetaSk()), {
      [TABLE_PK]: teamPk(teamId),
      [TABLE_SK]: teamMetaSk(),
      teamId,
      name: 'Hawks',
      timeZone: 'UTC',
      defaultChatId: randomUUID(),
      createdBy: 'admin',
      createdAt: new Date().toISOString(),
    });
    store.set(itemKey(teamPk(teamId), teamMemberSk('admin')), {
      [TABLE_PK]: teamPk(teamId),
      [TABLE_SK]: teamMemberSk('admin'),
      userId: 'admin',
      role: 'team_admin',
      joinedAt: new Date().toISOString(),
    });

    const created = await createEvent({
      teamId,
      userId: 'admin',
      body: {
        eventType: 'game',
        title: 'Opener',
        startsAt: '2026-09-01T12:00:00.000Z',
        endsAt: '2026-09-01T14:00:00.000Z',
        location: 'Away',
        latitude: 30,
        longitude: -97,
        recurrence: { frequency: 'WEEKLY', interval: 1, until: '2026-12-01T00:00:00.000Z' },
      },
    });
    expect(store.has(itemKey(teamPk(teamId), eventSk(created.eventId)))).toBe(true);
  });
});
