/**
 * Reminder instant selection and the due sweep.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryTable } from '../../lib/dynamo/memory-table.js';
import { TABLE_PK, TABLE_SK, eventSk, prefsSk, rsvpSk, teamMetaSk, teamPk, userPk } from '../../lib/dynamo/keys.js';

const { store, itemKey } = memoryTable;
const { fanoutJobs } = vi.hoisted(() => ({
  fanoutJobs: [] as Array<Record<string, unknown>>,
}));

vi.mock('../../lib/fanout-enqueue.js', () => ({
  enqueueFanout: async (job: Record<string, unknown>): Promise<void> => {
    fanoutJobs.push(job);
  },
  resetFanoutSqsClient: (): void => undefined,
}));

vi.mock('../../lib/dynamo/access.js', async () => (await import('../../lib/dynamo/memory-table.js')).memoryAccess);

const { reminderInstants, slotName, syncReminders, runDueReminders } = await import('./reminders.js');

describe('reminderInstants', () => {
  const now = new Date('2026-09-01T12:00:00.000Z');

  it('schedules every allowed evening hour and lead time for the occurrence', () => {
    const instants = reminderInstants({
      startsAt: '2026-09-02T17:00:00.000Z',
      timeZone: 'America/New_York',
      now,
    });
    const byName = Object.fromEntries(instants.map((row) => [slotName(row.slot), row.dueAt]));
    expect(Object.keys(byName).sort()).toEqual(
      ['before120', 'before15', 'before30', 'before60', 'evening17', 'evening18', 'evening19', 'evening20', 'evening21'],
    );
    // 6 pm and 1 pm New York (EDT) the day before and on the day.
    expect(byName.evening18).toBe('2026-09-01T22:00:00.000Z');
    expect(byName.before60).toBe('2026-09-02T16:00:00.000Z');
    expect(byName.before15).toBe('2026-09-02T16:45:00.000Z');
  });

  it('skips instants that are already due', () => {
    const instants = reminderInstants({
      startsAt: '2026-09-02T17:00:00.000Z',
      timeZone: 'America/New_York',
      now: new Date('2026-09-02T15:30:00.000Z'),
    });
    expect(instants.map((row) => slotName(row.slot))).toEqual(['before15', 'before30', 'before60']);
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

  const rsvp = (occurrence: string, userId: string, status: string): void => {
    store.set(itemKey(teamPk('t1'), rsvpSk(occurrence, 'e1', userId)), {
      [TABLE_PK]: teamPk('t1'),
      [TABLE_SK]: rsvpSk(occurrence, 'e1', userId),
      userId,
      status,
      eventId: 'e1',
      occurrenceStartsAt: occurrence,
    });
  };

  const prefer = (userId: string, prefs: Record<string, number | null>): void => {
    store.set(itemKey(userPk(userId), prefsSk()), { [TABLE_PK]: userPk(userId), [TABLE_SK]: prefsSk(), userId, ...prefs });
  };

  it('sends each reminder only to RSVPs whose chosen time matches', async () => {
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
    rsvp(occurrence, 'going-user', 'going');
    rsvp(occurrence, 'maybe-user', 'maybe');
    rsvp(occurrence, 'out-user', 'not_going');
    rsvp(occurrence, 'early-user', 'going');
    rsvp(occurrence, 'quiet-user', 'going');
    prefer('early-user', { reminderEveningHour: 17 });
    prefer('quiet-user', { reminderEveningHour: null, reminderLeadMinutes: null });

    // 6 pm New York the day before: the 5 pm and 6 pm rows are both due.
    await runDueReminders(new Date('2026-09-01T22:00:00.000Z'));

    expect(fanoutJobs).toEqual([
      expect.objectContaining({ kind: 'evening', hour: 17, userIds: ['early-user'] }),
      expect.objectContaining({
        type: 'event_reminder',
        kind: 'evening',
        hour: 18,
        title: 'Saturday game',
        location: 'Field 2',
        userIds: ['going-user', 'maybe-user'],
      }),
    ]);

    // The day of: default lead time is one hour; nobody chose the others.
    fanoutJobs.length = 0;
    await runDueReminders(new Date('2026-09-02T17:00:00.000Z'));
    expect(fanoutJobs).toEqual([
      expect.objectContaining({ kind: 'before', minutes: 60, userIds: ['early-user', 'going-user', 'maybe-user'] }),
    ]);
  });

  it('writes the following occurrence after the last reminder of a date', async () => {
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

    await runDueReminders(new Date('2026-09-02T16:45:00.000Z'));

    const rows = [...store.values()].filter((item) => String(item[TABLE_SK]).startsWith('REMINDER#'));
    expect(new Set(rows.map((row) => row.occurrenceStartsAt))).toEqual(new Set(['2026-09-09T17:00:00.000Z']));
    expect(rows).toHaveLength(9);
  });

  it('still sends and chains a row written before reminder times existed', async () => {
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
      title: 'Wednesday practice',
      startsAt: '2026-09-02T17:00:00.000Z',
      recurrence: { frequency: 'WEEKLY', interval: 1, byWeekDay: ['WE'] },
    });
    const legacySk = 'REMINDER#2026-09-02T16:00:00.000Z#e1#2026-09-02T17:00:00.000Z#hour';
    store.set(itemKey('REMINDERS', legacySk), {
      [TABLE_PK]: 'REMINDERS',
      [TABLE_SK]: legacySk,
      teamId: 't1',
      eventId: 'e1',
      title: 'Wednesday practice',
      occurrenceStartsAt: '2026-09-02T17:00:00.000Z',
      kind: 'hour',
      dueAt: '2026-09-02T16:00:00.000Z',
    });
    rsvp('2026-09-02T17:00:00.000Z', 'going-user', 'going');

    await runDueReminders(new Date('2026-09-02T16:00:00.000Z'));

    expect(fanoutJobs).toEqual([expect.objectContaining({ kind: 'before', minutes: 60, userIds: ['going-user'] })]);
    const rows = [...store.values()].filter((item) => String(item[TABLE_SK]).startsWith('REMINDER#'));
    expect(rows.every((row) => row.occurrenceStartsAt === '2026-09-09T17:00:00.000Z')).toBe(true);
  });
});
