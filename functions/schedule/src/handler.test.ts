/**
 * Schedule Lambda HTTP coverage with an in-memory DynamoDB store.
 */

import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { issueLocalTokens } from '../../lib/auth/local-jwt.js';
import type { TeamPermission, TeamRole } from '@gameplan/types';
import { DEFAULT_ROLE_PERMISSIONS } from '@gameplan/types';
import { TABLE_PK, TABLE_SK, eventSk, rolePermissionsSk, teamMemberSk, teamMetaSk, teamPk } from '../../lib/dynamo/keys.js';

const store = new Map<string, Record<string, unknown>>();

const itemKey = (pk: string, sk: string): string => `${pk}\0${sk}`;

vi.mock('../../lib/dynamo/access.js', () => ({
  getItem: async <T extends Record<string, unknown>>(
    pk: string,
    sk: string,
  ): Promise<T | undefined> => store.get(itemKey(pk, sk)) as T | undefined,
  putItem: async (item: Record<string, unknown>): Promise<void> => {
    const pk = String(item[TABLE_PK]);
    const sk = String(item[TABLE_SK]);
    store.set(itemKey(pk, sk), item);
  },
  deleteItem: async (pk: string, sk: string): Promise<void> => {
    store.delete(itemKey(pk, sk));
  },
  transactWrite: async (): Promise<void> => {
    throw new Error('not_used');
  },
  queryBySkPrefix: async <T extends Record<string, unknown>>(
    pk: string,
    skPrefix: string,
  ): Promise<T[]> => {
    const items: T[] = [];
    for (const [key, item] of store) {
      const [itemPk, itemSk] = key.split('\0');
      if (itemPk === pk && itemSk.startsWith(skPrefix)) items.push(item as T);
    }
    return items;
  },
  queryBySkBetween: async <T extends Record<string, unknown>>(
    pk: string,
    lo: string,
    hi: string,
  ): Promise<T[]> => {
    const items: T[] = [];
    for (const [key, item] of store) {
      const [itemPk, itemSk] = key.split('\0');
      if (itemPk === pk && itemSk >= lo && itemSk <= hi) items.push(item as T);
    }
    return items;
  },
  queryAll: async () => [],
  queryPage: async () => ({ items: [] }),
  queryPartition: async () => [],
  encodeCursor: () => undefined,
  decodeCursor: () => undefined,
}));

vi.mock('../../lib/fanout-enqueue.js', () => ({
  enqueueFanout: async (): Promise<void> => undefined,
  resetFanoutSqsClient: (): void => undefined,
}));

const { handler } = await import('./handler.js');

/**
 * Builds a minimal HTTP API event for schedule routes.
 *
 * @param method - The HTTP method.
 * @param path - The request path, including `/schedule`.
 * @param options - Optional body, headers, and query string.
 * @returns An HTTP API event.
 */
const httpEvent = (
  method: string,
  path: string,
  options: {
    body?: unknown;
    headers?: Record<string, string>;
    query?: Record<string, string>;
  } = {},
): APIGatewayProxyEventV2 =>
  ({
    version: '2.0',
    rawPath: path,
    headers: options.headers ?? {},
    queryStringParameters: options.query,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    requestContext: { http: { method, path } },
  }) as APIGatewayProxyEventV2;

/**
 * Issues a bearer Authorization header for a synthetic user.
 *
 * @param userId - Optional fixed user id.
 * @returns Auth header and user id.
 */
const authFor = (userId = randomUUID()): { authorization: string; userId: string } => {
  const email = `${userId}@example.com`;
  const { accessToken } = issueLocalTokens(userId, email);
  return { authorization: `Bearer ${accessToken}`, userId };
};

/**
 * Seeds a team with one roster member and optional role permissions.
 *
 * @param input - Team and membership details.
 * @returns The team id.
 */
const seedTeam = (input: {
  teamId?: string;
  userId: string;
  role: TeamRole;
  permissions?: Partial<Record<TeamRole, readonly TeamPermission[]>>;
}): string => {
  const teamId = input.teamId ?? randomUUID();
  store.set(itemKey(teamPk(teamId), teamMetaSk()), {
    [TABLE_PK]: teamPk(teamId),
    [TABLE_SK]: teamMetaSk(),
    teamId,
    name: 'Hawks',
    timeZone: 'America/New_York',
    defaultChatId: randomUUID(),
    createdBy: input.userId,
    createdAt: new Date().toISOString(),
  });
  store.set(itemKey(teamPk(teamId), teamMemberSk(input.userId)), {
    [TABLE_PK]: teamPk(teamId),
    [TABLE_SK]: teamMemberSk(input.userId),
    userId: input.userId,
    role: input.role,
    joinedAt: new Date().toISOString(),
  });

  const matrix = input.permissions ?? DEFAULT_ROLE_PERMISSIONS;
  for (const [role, permissions] of Object.entries(matrix)) {
    store.set(itemKey(teamPk(teamId), rolePermissionsSk(role)), {
      [TABLE_PK]: teamPk(teamId),
      [TABLE_SK]: rolePermissionsSk(role),
      role,
      permissions: [...permissions],
    });
  }
  return teamId;
};

/**
 * Parses a JSON response body.
 *
 * @param result - A structured proxy result.
 * @returns The parsed body.
 */
const bodyOf = (result: { body?: string }): Record<string, unknown> =>
  JSON.parse(result.body ?? '{}') as Record<string, unknown>;

describe('schedule handler (in-memory)', () => {
  beforeEach(() => {
    store.clear();
    delete process.env.COGNITO_USER_POOL_ID;
    delete process.env.COGNITO_CLIENT_ID;
    process.env.LOCAL_JWT_SECRET = 'schedule-handler-test-secret';
  });

  afterEach(() => {
    store.clear();
  });

  it('creates a recurring practice, expands a window, and stores per-occurrence RSVPs', async () => {
    const admin = authFor();
    const teamId = seedTeam({ userId: admin.userId, role: 'team_admin' });

    const created = await handler(
      httpEvent('POST', `/schedule/teams/${teamId}/events`, {
        headers: { authorization: admin.authorization },
        body: {
          eventType: 'practice',
          title: 'Wednesday practice',
          startsAt: '2026-09-02T17:00:00.000Z',
          endsAt: '2026-09-02T18:30:00.000Z',
          location: 'Field 2',
          recurrence: { frequency: 'WEEKLY', interval: 1, byWeekDay: ['WE'] },
        },
      }),
    );
    expect(created.statusCode).toBe(201);
    const event = bodyOf(created);
    expect(event).toMatchObject({
      teamId,
      eventType: 'practice',
      title: 'Wednesday practice',
      location: 'Field 2',
    });
    const eventId = event.eventId as string;

    const window = await handler(
      httpEvent('GET', `/schedule/teams/${teamId}`, {
        headers: { authorization: admin.authorization },
        query: {
          from: '2026-09-01T00:00:00.000Z',
          to: '2026-09-30T23:59:59.999Z',
        },
      }),
    );
    expect(window.statusCode).toBe(200);
    const schedule = bodyOf(window);
    const occurrences = schedule.occurrences as Array<Record<string, unknown>>;
    expect(occurrences.length).toBe(5);
    expect(occurrences[0]).toMatchObject({
      eventId,
      startsAt: '2026-09-02T17:00:00.000Z',
      endsAt: '2026-09-02T18:30:00.000Z',
      rsvps: [],
    });

    const rsvp = await handler(
      httpEvent('PUT', `/schedule/teams/${teamId}/rsvps`, {
        headers: { authorization: admin.authorization },
        body: {
          eventId,
          occurrenceStartsAt: '2026-09-09T17:00:00.000Z',
          status: 'going',
        },
      }),
    );
    expect(rsvp.statusCode).toBe(200);
    expect(bodyOf(rsvp)).toMatchObject({
      eventId,
      occurrenceStartsAt: '2026-09-09T17:00:00.000Z',
      status: 'going',
      userId: admin.userId,
    });

    const again = await handler(
      httpEvent('GET', `/schedule/teams/${teamId}`, {
        headers: { authorization: admin.authorization },
        query: {
          from: '2026-09-01T00:00:00.000Z',
          to: '2026-09-30T23:59:59.999Z',
        },
      }),
    );
    const withRsvp = (bodyOf(again).occurrences as Array<Record<string, unknown>>).find(
      (row) => row.startsAt === '2026-09-09T17:00:00.000Z',
    );
    expect(withRsvp?.rsvps).toEqual([{ userId: admin.userId, status: 'going' }]);
  });

  it('creates a game, updates it, and rejects manage_events for a coach without the grant', async () => {
    const admin = authFor();
    const coach = authFor();
    const teamId = seedTeam({ userId: admin.userId, role: 'team_admin' });
    store.set(itemKey(teamPk(teamId), teamMemberSk(coach.userId)), {
      [TABLE_PK]: teamPk(teamId),
      [TABLE_SK]: teamMemberSk(coach.userId),
      userId: coach.userId,
      role: 'coach',
      joinedAt: new Date().toISOString(),
    });

    const created = await handler(
      httpEvent('POST', `/schedule/teams/${teamId}/events`, {
        headers: { authorization: admin.authorization },
        body: {
          eventType: 'game',
          title: 'Home opener',
          startsAt: '2026-09-12T15:00:00.000Z',
          location: 'Main stadium',
        },
      }),
    );
    expect(created.statusCode).toBe(201);
    const eventId = bodyOf(created).eventId as string;

    const updated = await handler(
      httpEvent('PATCH', `/schedule/teams/${teamId}/events/${eventId}`, {
        headers: { authorization: admin.authorization },
        body: { title: 'Home opener (rescheduled)', startsAt: '2026-09-13T15:00:00.000Z' },
      }),
    );
    expect(updated.statusCode).toBe(200);
    expect(bodyOf(updated)).toMatchObject({
      title: 'Home opener (rescheduled)',
      startsAt: '2026-09-13T15:00:00.000Z',
    });

    const got = await handler(
      httpEvent('GET', `/schedule/teams/${teamId}/events/${eventId}`, {
        headers: { authorization: coach.authorization },
      }),
    );
    expect(got.statusCode).toBe(200);

    const forbidden = await handler(
      httpEvent('POST', `/schedule/teams/${teamId}/events`, {
        headers: { authorization: coach.authorization },
        body: {
          eventType: 'practice',
          title: 'Nope',
          startsAt: '2026-09-20T17:00:00.000Z',
        },
      }),
    );
    expect(forbidden.statusCode).toBe(403);
  });

  it('rejects an oversized window and a non-member schedule read', async () => {
    const admin = authFor();
    const stranger = authFor();
    const teamId = seedTeam({ userId: admin.userId, role: 'team_admin' });

    const large = await handler(
      httpEvent('GET', `/schedule/teams/${teamId}`, {
        headers: { authorization: admin.authorization },
        query: {
          from: '2026-01-01T00:00:00.000Z',
          to: '2026-06-01T00:00:00.000Z',
        },
      }),
    );
    expect(large.statusCode).toBe(400);
    expect(bodyOf(large)).toEqual({ error: 'window_too_large' });

    const denied = await handler(
      httpEvent('GET', `/schedule/teams/${teamId}`, {
        headers: { authorization: stranger.authorization },
        query: {
          from: '2026-09-01T00:00:00.000Z',
          to: '2026-09-30T23:59:59.999Z',
        },
      }),
    );
    expect(denied.statusCode).toBe(403);
  });

  it('returns health for the schedule area', async () => {
    const result = await handler(httpEvent('GET', '/schedule/health'));
    expect(result.statusCode).toBe(200);
    expect(bodyOf(result)).toEqual({ ok: true, service: 'schedule' });
  });

  it('keeps event rows under the expected sort key', async () => {
    const admin = authFor();
    const teamId = seedTeam({ userId: admin.userId, role: 'team_admin' });
    const created = await handler(
      httpEvent('POST', `/schedule/teams/${teamId}/events`, {
        headers: { authorization: admin.authorization },
        body: {
          eventType: 'practice',
          title: 'Solo',
          startsAt: '2026-09-05T12:00:00.000Z',
        },
      }),
    );
    const eventId = bodyOf(created).eventId as string;
    expect(store.has(itemKey(teamPk(teamId), eventSk(eventId)))).toBe(true);
  });
});
