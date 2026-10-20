/**
 * Volunteer sign-ups: who may set slots, take places, and act for someone else,
 * and that helpers get event reminders.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { issueLocalTokens } from '../../lib/auth/local-jwt.js';
import { memoryTable } from '../../lib/dynamo/memory-table.js';
import {
  TABLE_PK,
  TABLE_SK,
  eventSk,
  guardianSk,
  rolePermissionsSk,
  teamMemberSk,
  teamMetaSk,
  teamPk,
  userPk,
} from '../../lib/dynamo/keys.js';

const { fanoutJobs } = vi.hoisted(() => ({ fanoutJobs: [] as Array<Record<string, unknown>> }));

vi.mock('../../lib/dynamo/access.js', async () => (await import('../../lib/dynamo/memory-table.js')).memoryAccess);
vi.mock('../../lib/fanout-enqueue.js', () => ({
  enqueueFanout: async (job: Record<string, unknown>): Promise<void> => {
    fanoutJobs.push(job);
  },
  resetFanoutSqsClient: (): void => undefined,
}));

const { handler } = await import('./handler.js');
const { runDueReminders, syncReminders } = await import('./reminders.js');

const STARTS = '2030-05-04T15:00:00.000Z';

const call = async (method: string, path: string, userId: string, body?: unknown, query?: Record<string, string>) => {
  const result = (await handler({
    version: '2.0',
    rawPath: path,
    headers: {
      authorization: `Bearer ${issueLocalTokens(userId, `${userId}@example.com`).accessToken}`,
      'content-type': 'application/json',
    },
    queryStringParameters: query,
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { http: { method, path } },
  } as unknown as APIGatewayProxyEventV2)) as APIGatewayProxyStructuredResultV2;
  return { status: result.statusCode, body: JSON.parse(String(result.body ?? '{}')) as Record<string, unknown> };
};

type Slot = { slotId: string; label: string; claims: { userId: string; claimedBy: string }[] };
const slotsOf = (body: Record<string, unknown>): Slot[] => body.slots as Slot[];

const at = { eventId: 'e1', occurrenceStartsAt: STARTS };

describe('volunteer sign-ups', () => {
  beforeEach(() => {
    memoryTable.clear();
    fanoutJobs.length = 0;
    memoryTable.put({ [TABLE_PK]: teamPk('t1'), [TABLE_SK]: teamMetaSk(), teamId: 't1', name: 'Hawks', timeZone: 'UTC' });
    for (const [userId, role] of [
      ['coach', 'coach'],
      ['ana', 'player'],
      ['ben', 'player'],
      ['kid', 'player'],
      ['cal', 'player'],
    ] as const) {
      memoryTable.put({ [TABLE_PK]: teamPk('t1'), [TABLE_SK]: teamMemberSk(userId), userId, role });
    }
    memoryTable.put({ [TABLE_PK]: teamPk('t1'), [TABLE_SK]: rolePermissionsSk('coach'), role: 'coach', permissions: ['manage_events'] });
    memoryTable.put({ [TABLE_PK]: teamPk('t1'), [TABLE_SK]: rolePermissionsSk('player'), role: 'player', permissions: [] });
    memoryTable.put({ [TABLE_PK]: userPk('kid'), [TABLE_SK]: guardianSk('mom'), adultId: 'mom', minorId: 'kid' });
    memoryTable.put({
      [TABLE_PK]: teamPk('t1'),
      [TABLE_SK]: eventSk('e1'),
      eventId: 'e1',
      teamId: 't1',
      eventType: 'game',
      title: 'Saturday game',
      startsAt: STARTS,
      createdBy: 'coach',
      createdAt: '2030-01-01T00:00:00.000Z',
      updatedAt: '2030-01-01T00:00:00.000Z',
    });
  });

  const setSlots = () =>
    call('PUT', '/schedule/teams/t1/signups', 'coach', { ...at, slots: [{ label: 'Snacks', capacity: 1 }, { label: 'Drivers', capacity: 3 }] });

  it('lets only staff set slots, and keeps people on a slot that stays', async () => {
    expect((await call('PUT', '/schedule/teams/t1/signups', 'ana', { ...at, slots: [] })).status).toBe(403);
    const set = await setSlots();
    expect(set.status).toBe(200);
    const [snacks] = slotsOf(set.body);
    await call('PUT', '/schedule/teams/t1/signups/claim', 'ana', { ...at, slotId: snacks?.slotId });

    const renamed = await call('PUT', '/schedule/teams/t1/signups', 'coach', {
      ...at,
      slots: [{ slotId: snacks?.slotId, label: 'Halftime snacks', capacity: 2 }],
    });
    expect(slotsOf(renamed.body)).toEqual([
      expect.objectContaining({ label: 'Halftime snacks', claims: [{ userId: 'ana', claimedBy: 'ana', displayName: 'Player' }] }),
    ]);
    const shrink = await call('PUT', '/schedule/teams/t1/signups', 'coach', {
      ...at,
      slots: [{ slotId: snacks?.slotId, label: 'Halftime snacks', capacity: 1 }, { label: 'Extra', capacity: 1 }],
    });
    expect(shrink.status).toBe(200);
    expect(fanoutJobs.some((job) => job.type === 'signups_changed')).toBe(true);
  });

  it('fills a slot, refuses the next person, and lets someone give their place up', async () => {
    const [snacks] = slotsOf((await setSlots()).body);
    const claim = (userId: string) => call('PUT', '/schedule/teams/t1/signups/claim', userId, { ...at, slotId: snacks?.slotId });
    expect((await claim('ana')).status).toBe(200);
    const full = await claim('ben');
    expect(full).toEqual({ status: 400, body: { error: 'signup_full' } });
    expect(slotsOf((await claim('ana')).body)[0]?.claims).toEqual([]);
    expect((await claim('ben')).status).toBe(200);
  });

  it('lets a guardian sign up their child and staff remove anyone, but nobody else act for others', async () => {
    const [, drivers] = slotsOf((await setSlots()).body);
    const claimFor = (callerId: string, forUserId: string) =>
      call('PUT', '/schedule/teams/t1/signups/claim', callerId, { ...at, slotId: drivers?.slotId, forUserId });

    memoryTable.put({ [TABLE_PK]: teamPk('t1'), [TABLE_SK]: teamMemberSk('mom'), userId: 'mom', role: 'parent' });
    const signed = await claimFor('mom', 'kid');
    expect(slotsOf(signed.body)[1]?.claims).toEqual([expect.objectContaining({ userId: 'kid', claimedBy: 'mom' })]);
    expect((await claimFor('ben', 'cal')).status).toBe(403);
    expect(slotsOf((await claimFor('coach', 'kid')).body)[1]?.claims).toEqual([]);
  });

  it('reminds people who signed up to help even without an RSVP', async () => {
    const [snacks] = slotsOf((await setSlots()).body);
    await call('PUT', '/schedule/teams/t1/signups/claim', 'cal', { ...at, slotId: snacks?.slotId });
    await syncReminders({
      teamId: 't1',
      eventId: 'e1',
      title: 'Saturday game',
      startsAt: STARTS,
      timeZone: 'UTC',
      now: new Date('2030-05-01T00:00:00.000Z'),
    });
    fanoutJobs.length = 0;
    await runDueReminders(new Date('2030-05-04T14:00:00.000Z'));
    // The evening-before and one-hour reminders are both due by then.
    expect(fanoutJobs).toEqual([
      expect.objectContaining({ type: 'event_reminder', kind: 'evening', hour: 18, userIds: ['cal'] }),
      expect.objectContaining({ type: 'event_reminder', kind: 'before', minutes: 60, userIds: ['cal'] }),
    ]);
  });
});
