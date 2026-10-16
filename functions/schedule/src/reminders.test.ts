/**
 * Reminder instant selection and the due sweep.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TABLE_PK, TABLE_SK, eventSk, rsvpSk, teamMetaSk, teamPk } from '../../lib/dynamo/keys.js';

const store = new Map<string, Record<string, unknown>>();
const itemKey = (pk: string, sk: string): string => `${pk}\0${sk}`;
const { fanoutJobs } = vi.hoisted(() => ({
  fanoutJobs: [] as Array<Record<string, unknown>>,
}));

vi.mock('../../lib/fanout-enqueue.js', () => ({
  enqueueFanout: async (job: Record<string, unknown>): Promise<void> => {
    fanoutJobs.push(job);
  },
  resetFanoutSqsClient: (): void => undefined,
}));

vi.mock('../../lib/dynamo/access.js', () => ({
  getItem: async <T extends Record<string, unknown>>(pk: string, sk: string) =>
    store.get(itemKey(pk, sk)) as T | undefined,
  putItem: async (item: Record<string, unknown>): Promise<void> => {
    store.set(itemKey(String(item[TABLE_PK]), String(item[TABLE_SK])), item);
  },
  deleteItem: async (pk: string, sk: string): Promise<void> => {
    store.delete(itemKey(pk, sk));
  },
  queryBySkPrefix: async <T extends Record<string, unknown>>(pk: string, skPrefix: string) => {
    const items: T[] = [];
    for (const [key, item] of store) {
      const [itemPk, itemSk] = key.split('\0');
      if (itemPk === pk && itemSk.startsWith(skPrefix)) items.push(item as T);
    }
    return items;
  },
  queryBySkBetween: async <T extends Record<string, unknown>>(pk: string, lo: string, hi: string) => {
    const items: T[] = [];
    for (const [key, item] of store) {
      const [itemPk, itemSk] = key.split('\0');
      if (itemPk === pk && itemSk >= lo && itemSk <= hi) items.push(item as T);
    }
    return items;
  },
  transactWrite: async (): Promise<void> => undefined,
  queryAll: async () => [],
  queryPage: async () => ({ items: [] }),
  queryPartition: async () => [],
  encodeCursor: () => undefined,
  decodeCursor: () => undefined,
}));

const { reminderInstants, syncReminders, runDueReminders } = await import('./reminders.js');

describe('reminderInstants', () => {
  const now = new Date('2026-09-01T12:00:00.000Z');

  it('schedules 18:00 the local day before and one hour before the start', () => {
    const instants = reminderInstants({
      startsAt: '2026-09-02T17:00:00.000Z',
      timeZone: 'America/New_York',
      now,
    });
    expect(instants).toEqual([
      {
        occurrenceStartsAt: '2026-09-02T17:00:00.000Z',
        kind: 'evening',
        dueAt: '2026-09-01T22:00:00.000Z',
      },
      {
        occurrenceStartsAt: '2026-09-02T17:00:00.000Z',
        kind: 'hour',
        dueAt: '2026-09-02T16:00:00.000Z',
      },
    ]);
  });

  it('skips instants that are already due', () => {
    const instants = reminderInstants({
      startsAt: '2026-09-02T17:00:00.000Z',
      timeZone: 'America/New_York',
      now: new Date('2026-09-02T15:30:00.000Z'),
    });
    expect(instants.map((row) => row.kind)).toEqual(['hour']);
  });

  it('keeps only the next occurrence of a series', () => {
    const instants = reminderInstants({
      startsAt: '2026-09-02T17:00:00.000Z',
      recurrence: { frequency: 'WEEKLY', interval: 1, byWeekDay: ['WE'] },
      timeZone: 'UTC',
      now,
    });
    const occurrences = new Set(instants.map((row) => row.occurrenceStartsAt));
    expect([...occurrences]).toEqual(['2026-09-02T17:00:00.000Z']);
  });
});

describe('runDueReminders', () => {
  beforeEach(() => {
    store.clear();
    fanoutJobs.length = 0;
  });
  afterEach(() => store.clear());

  it('notifies going and maybe RSVPs and drops the due row', async () => {
    const now = new Date('2026-09-01T12:00:00.000Z');
    await syncReminders({
      teamId: 't1',
      eventId: 'e1',
      title: 'Saturday game',
      startsAt: '2026-09-02T17:00:00.000Z',
      location: 'Field 2',
      timeZone: 'America/New_York',
      now: new Date('2026-09-01T00:00:00.000Z'),
    });
    const occurrence = '2026-09-02T17:00:00.000Z';
    for (const [userId, status] of [
      ['going-user', 'going'],
      ['maybe-user', 'maybe'],
      ['out-user', 'not_going'],
    ] as const) {
      store.set(itemKey(teamPk('t1'), rsvpSk(occurrence, 'e1', userId)), {
        [TABLE_PK]: teamPk('t1'),
        [TABLE_SK]: rsvpSk(occurrence, 'e1', userId),
        userId,
        status,
        eventId: 'e1',
        occurrenceStartsAt: occurrence,
      });
    }

    await runDueReminders(new Date('2026-09-01T22:00:00.000Z'));

    expect(fanoutJobs).toEqual([
      expect.objectContaining({
        type: 'event_reminder',
        kind: 'evening',
        title: 'Saturday game',
        location: 'Field 2',
        userIds: ['going-user', 'maybe-user'],
      }),
    ]);

    await runDueReminders(now);
    expect(fanoutJobs).toHaveLength(1);
  });

  it('writes the following occurrence after the hour reminder', async () => {
    store.set(itemKey(teamPk('t1'), teamMetaSk()), {
      [TABLE_PK]: teamPk('t1'),
      [TABLE_SK]: teamMetaSk(),
      teamId: 't1',
      timeZone: 'UTC',
    });
    store.set(itemKey(teamPk('t1'), eventSk('e1')), {
      [TABLE_PK]: teamPk('t1'),
      [TABLE_SK]: eventSk('e1'),
      eventId: 'e1',
      teamId: 't1',
      title: 'Wednesday practice',
      startsAt: '2026-09-02T17:00:00.000Z',
      recurrence: { frequency: 'WEEKLY', interval: 1, byWeekDay: ['WE'] },
    });
    await syncReminders({
      teamId: 't1',
      eventId: 'e1',
      title: 'Wednesday practice',
      startsAt: '2026-09-02T17:00:00.000Z',
      recurrence: { frequency: 'WEEKLY', interval: 1, byWeekDay: ['WE'] },
      timeZone: 'UTC',
      now: new Date('2026-09-01T12:00:00.000Z'),
    });

    await runDueReminders(new Date('2026-09-02T16:00:00.000Z'));

    const rows = [...store.values()].filter((item) => String(item[TABLE_SK]).startsWith('REMINDER#'));
    expect(rows.map((row) => row.occurrenceStartsAt)).toEqual([
      '2026-09-09T17:00:00.000Z',
      '2026-09-09T17:00:00.000Z',
    ]);
    expect(rows.map((row) => row.kind).sort()).toEqual(['evening', 'hour']);
  });
});
