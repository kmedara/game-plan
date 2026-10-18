/**
 * Schedule Lambda HTTP coverage with an in-memory DynamoDB store.
 */

import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { issueLocalTokens } from '../../lib/auth/local-jwt.js';
import type { TeamPermission, TeamRole } from '@gameplan/types';
import { DEFAULT_ROLE_PERMISSIONS } from '@gameplan/types';
import {
  TABLE_PK,
  TABLE_SK,
  chatMemberSk,
  chatMetaSk,
  chatPk,
  eventSk,
  fixtureInviteSk,
  fixtureLinkSk,
  fixtureMetaSk,
  fixturePk,
  guardianSk,
  profileSk,
  rolePermissionsSk,
  teamMemberSk,
  teamMetaSk,
  teamPk,
  userChatSk,
  userPk,
} from '../../lib/dynamo/keys.js';

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
  name?: string;
  sport?: string;
  permissions?: Partial<Record<TeamRole, readonly TeamPermission[]>>;
}): string => {
  const teamId = input.teamId ?? randomUUID();
  store.set(itemKey(teamPk(teamId), teamMetaSk()), {
    [TABLE_PK]: teamPk(teamId),
    [TABLE_SK]: teamMetaSk(),
    teamId,
    name: input.name ?? 'Hawks',
    ...(input.sport !== undefined ? { sport: input.sport } : {}),
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
 * Adds another roster member to a seeded team.
 *
 * @param teamId - The team id.
 * @param userId - The member.
 * @param role - The member's role.
 */
const seedMember = (teamId: string, userId: string, role: TeamRole): void => {
  store.set(itemKey(teamPk(teamId), teamMemberSk(userId)), {
    [TABLE_PK]: teamPk(teamId),
    [TABLE_SK]: teamMemberSk(userId),
    userId,
    role,
    joinedAt: new Date().toISOString(),
  });
};

/** A one-off game body. */
const gameBody = (side: 'home' | 'away', opponentName: string) => ({
  eventType: 'game' as const,
  title: opponentName,
  startsAt: '2026-10-03T18:00:00.000Z',
  endsAt: '2026-10-03T19:30:00.000Z',
  location: 'Pitch 1',
  opponentName,
  side,
});

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

  it('keeps RSVPs independent for two events that share a start instant', async () => {
    const admin = authFor();
    const teamId = seedTeam({ userId: admin.userId, role: 'team_admin' });
    const startsAt = '2026-09-15T18:00:00.000Z';

    const createA = await handler(
      httpEvent('POST', `/schedule/teams/${teamId}/events`, {
        headers: { authorization: admin.authorization },
        body: {
          eventType: 'practice',
          title: 'Practice A',
          startsAt,
        },
      }),
    );
    const createB = await handler(
      httpEvent('POST', `/schedule/teams/${teamId}/events`, {
        headers: { authorization: admin.authorization },
        body: {
          eventType: 'meeting',
          title: 'Meeting B',
          startsAt,
        },
      }),
    );
    expect(createA.statusCode).toBe(201);
    expect(createB.statusCode).toBe(201);
    const eventA = bodyOf(createA).eventId as string;
    const eventB = bodyOf(createB).eventId as string;

    const rsvpA = await handler(
      httpEvent('PUT', `/schedule/teams/${teamId}/rsvps`, {
        headers: { authorization: admin.authorization },
        body: { eventId: eventA, occurrenceStartsAt: startsAt, status: 'going' },
      }),
    );
    const rsvpB = await handler(
      httpEvent('PUT', `/schedule/teams/${teamId}/rsvps`, {
        headers: { authorization: admin.authorization },
        body: { eventId: eventB, occurrenceStartsAt: startsAt, status: 'maybe' },
      }),
    );
    expect(rsvpA.statusCode).toBe(200);
    expect(rsvpB.statusCode).toBe(200);

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
    const occurrences = bodyOf(window).occurrences as Array<Record<string, unknown>>;
    const occurrenceA = occurrences.find((row) => row.eventId === eventA);
    const occurrenceB = occurrences.find((row) => row.eventId === eventB);
    expect(occurrenceA?.rsvps).toEqual([{ userId: admin.userId, status: 'going' }]);
    expect(occurrenceB?.rsvps).toEqual([{ userId: admin.userId, status: 'maybe' }]);
  });

  it('stores and clears event coordinates with the location', async () => {
    const admin = authFor();
    const teamId = seedTeam({ userId: admin.userId, role: 'team_admin' });

    const created = await handler(
      httpEvent('POST', `/schedule/teams/${teamId}/events`, {
        headers: { authorization: admin.authorization },
        body: {
          eventType: 'game',
          title: 'Away game',
          startsAt: '2026-09-20T15:00:00.000Z',
          location: 'Lincoln Park, Chicago, IL',
          latitude: 41.9214,
          longitude: -87.6513,
        },
      }),
    );
    expect(created.statusCode).toBe(201);
    const event = bodyOf(created);
    expect(event).toMatchObject({
      location: 'Lincoln Park, Chicago, IL',
      latitude: 41.9214,
      longitude: -87.6513,
    });
    const eventId = event.eventId as string;

    const window = await handler(
      httpEvent('GET', `/schedule/teams/${teamId}`, {
        headers: { authorization: admin.authorization },
        query: {
          from: '2026-09-20T00:00:00.000Z',
          to: '2026-09-20T23:59:59.999Z',
        },
      }),
    );
    expect(window.statusCode).toBe(200);
    const occurrence = (bodyOf(window).occurrences as Array<Record<string, unknown>>)[0];
    expect(occurrence).toMatchObject({
      eventId,
      location: 'Lincoln Park, Chicago, IL',
      latitude: 41.9214,
      longitude: -87.6513,
    });

    const cleared = await handler(
      httpEvent('PATCH', `/schedule/teams/${teamId}/events/${eventId}`, {
        headers: { authorization: admin.authorization },
        body: { location: null, latitude: null, longitude: null },
      }),
    );
    expect(cleared.statusCode).toBe(200);
    expect(bodyOf(cleared).location).toBeUndefined();
    expect(bodyOf(cleared).latitude).toBeUndefined();
    expect(bodyOf(cleared).longitude).toBeUndefined();
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

  it('covers schedule validation, updates, and missing resources', async () => {
    const admin = authFor();
    const teamId = seedTeam({ userId: admin.userId, role: 'team_admin' });

    const badEnds = await handler(
      httpEvent('POST', `/schedule/teams/${teamId}/events`, {
        headers: { authorization: admin.authorization },
        body: {
          eventType: 'practice',
          title: 'Bad window',
          startsAt: '2026-09-05T18:00:00.000Z',
          endsAt: '2026-09-05T17:00:00.000Z',
        },
      }),
    );
    expect(badEnds.statusCode).toBe(400);
    expect(bodyOf(badEnds)).toEqual({ error: 'invalid_ends_at' });

    const created = await handler(
      httpEvent('POST', `/schedule/teams/${teamId}/events`, {
        headers: { authorization: admin.authorization },
        body: {
          eventType: 'game',
          title: 'Patch me',
          startsAt: '2026-09-10T15:00:00.000Z',
          endsAt: '2026-09-10T17:00:00.000Z',
          location: 'Field 1',
          latitude: 41.0,
          longitude: -87.0,
          recurrence: { frequency: 'WEEKLY', interval: 1, byWeekDay: ['TH'] },
        },
      }),
    );
    const eventId = bodyOf(created).eventId as string;

    const emptyPatch = await handler(
      httpEvent('PATCH', `/schedule/teams/${teamId}/events/${eventId}`, {
        headers: { authorization: admin.authorization },
        body: {},
      }),
    );
    expect(emptyPatch.statusCode).toBe(400);
    expect(bodyOf(emptyPatch)).toEqual({ error: 'invalid_body' });

    const patched = await handler(
      httpEvent('PATCH', `/schedule/teams/${teamId}/events/${eventId}`, {
        headers: { authorization: admin.authorization },
        body: {
          endsAt: '2026-09-10T18:00:00.000Z',
          latitude: 42.0,
          longitude: -88.0,
          recurrence: null,
        },
      }),
    );
    expect(patched.statusCode).toBe(200);
    expect(bodyOf(patched)).toMatchObject({
      endsAt: '2026-09-10T18:00:00.000Z',
      latitude: 42.0,
      longitude: -88.0,
    });
    expect(bodyOf(patched).recurrence).toBeUndefined();

    const recurring = await handler(
      httpEvent('PATCH', `/schedule/teams/${teamId}/events/${eventId}`, {
        headers: { authorization: admin.authorization },
        body: {
          recurrence: { frequency: 'WEEKLY', interval: 1, byWeekDay: ['FR'] },
        },
      }),
    );
    expect(recurring.statusCode).toBe(200);
    expect(bodyOf(recurring).recurrence).toMatchObject({ byWeekDay: ['FR'] });

    const missingEvent = await handler(
      httpEvent('GET', `/schedule/teams/${teamId}/events/${randomUUID()}`, {
        headers: { authorization: admin.authorization },
      }),
    );
    expect(missingEvent.statusCode).toBe(404);

    const badOccurrence = await handler(
      httpEvent('PUT', `/schedule/teams/${teamId}/rsvps`, {
        headers: { authorization: admin.authorization },
        body: {
          eventId,
          occurrenceStartsAt: '2026-01-01T00:00:00.000Z',
          status: 'going',
        },
      }),
    );
    expect(badOccurrence.statusCode).toBe(404);
    expect(bodyOf(badOccurrence)).toEqual({ error: 'not_found' });

    const badWindow = await handler(
      httpEvent('GET', `/schedule/teams/${teamId}`, {
        headers: { authorization: admin.authorization },
        query: { from: 'not-a-date', to: '2026-09-30T23:59:59.999Z' },
      }),
    );
    expect(badWindow.statusCode).toBe(400);

    expect(
      (
        await handler(
          httpEvent('GET', `/teams/${teamId}`, {
            headers: { authorization: admin.authorization },
            query: {
              from: '2026-09-01T00:00:00.000Z',
              to: '2026-09-30T23:59:59.999Z',
            },
          }),
        )
      ).statusCode,
    ).toBe(200);
    expect((await handler(httpEvent('GET', '/health'))).statusCode).toBe(200);
    expect((await handler(httpEvent('GET', '///'))).statusCode).toBe(404);
    expect(
      (
        await handler({
          version: '2.0',
          requestContext: { http: { method: 'GET', path: '/schedule/teams/x' } },
        } as APIGatewayProxyEventV2)
      ).statusCode,
    ).toBe(404);
    expect((await handler(httpEvent('GET', '/schedule/teams'))).statusCode).toBe(404);
    expect(
      (
        await handler(
          httpEvent('GET', `teams/${teamId}/events/${eventId}`, {
            headers: { authorization: admin.authorization },
          }),
        )
      ).statusCode,
    ).toBe(200);

    const { requireMembership } = await import('./schedule-store.js');
    await expect(requireMembership(teamId, randomUUID())).rejects.toThrow('not_a_member');
  });

  it('cancels one occurrence, edits one date, and deletes the series over HTTP', async () => {
    const admin = authFor();
    const teamId = seedTeam({ userId: admin.userId, role: 'team_admin' });
    const created = await handler(
      httpEvent('POST', `/schedule/teams/${teamId}/events`, {
        headers: { authorization: admin.authorization },
        body: {
          eventType: 'practice',
          title: 'Practice',
          startsAt: '2026-09-02T17:00:00.000Z',
          recurrence: { frequency: 'WEEKLY', interval: 1, byWeekDay: ['WE'] },
        },
      }),
    );
    const eventId = bodyOf(created).eventId as string;
    const list = async () => {
      const window = await handler(
        httpEvent('GET', `/schedule/teams/${teamId}`, {
          headers: { authorization: admin.authorization },
          query: { from: '2026-09-01T00:00:00.000Z', to: '2026-09-30T23:59:59.999Z' },
        }),
      );
      return bodyOf(window).occurrences as Array<{ startsAt: string; title: string; eventId: string }>;
    };

    const cancelled = await handler(
      httpEvent('DELETE', `/schedule/teams/${teamId}/events/${eventId}/occurrences`, {
        headers: { authorization: admin.authorization },
        body: { occurrenceStartsAt: '2026-09-09T17:00:00.000Z' },
      }),
    );
    expect(cancelled.statusCode).toBe(204);
    expect((await list()).map((row) => row.startsAt)).not.toContain('2026-09-09T17:00:00.000Z');

    const saved = await handler(
      httpEvent('POST', `/schedule/teams/${teamId}/events/${eventId}/occurrences`, {
        headers: { authorization: admin.authorization },
        body: {
          occurrenceStartsAt: '2026-09-16T17:00:00.000Z',
          title: 'Late practice',
          startsAt: '2026-09-16T20:00:00.000Z',
        },
      }),
    );
    expect(saved.statusCode).toBe(200);
    const rows = await list();
    expect(rows.some((row) => row.title === 'Late practice' && row.startsAt === '2026-09-16T20:00:00.000Z')).toBe(
      true,
    );

    const removed = await handler(
      httpEvent('DELETE', `/schedule/teams/${teamId}/events/${eventId}`, {
        headers: { authorization: admin.authorization },
      }),
    );
    expect(removed.statusCode).toBe(204);
    expect(await list()).toEqual([]);
  });

  it('stores a game lineup and rejects a practice lineup', async () => {
    const admin = authFor();
    const player = authFor();
    const teamId = seedTeam({ userId: admin.userId, role: 'team_admin' });
    store.set(itemKey(teamPk(teamId), teamMemberSk(player.userId)), {
      [TABLE_PK]: teamPk(teamId),
      [TABLE_SK]: teamMemberSk(player.userId),
      userId: player.userId,
      role: 'player',
      joinedAt: new Date().toISOString(),
    });

    const game = await handler(
      httpEvent('POST', `/schedule/teams/${teamId}/events`, {
        headers: { authorization: admin.authorization },
        body: {
          eventType: 'game',
          title: 'Saturday game',
          startsAt: '2026-09-05T18:00:00.000Z',
          recurrence: { frequency: 'WEEKLY', interval: 1, byWeekDay: ['SA'] },
        },
      }),
    );
    expect(game.statusCode).toBe(201);
    const eventId = bodyOf(game).eventId as string;
    const first = '2026-09-05T18:00:00.000Z';
    const second = '2026-09-12T18:00:00.000Z';

    const empty = await handler(
      httpEvent('GET', `/schedule/teams/${teamId}/lineup`, {
        headers: { authorization: player.authorization },
        query: { eventId, occurrenceStartsAt: first },
      }),
    );
    expect(empty.statusCode).toBe(200);
    expect(bodyOf(empty)).toMatchObject({ eventId, occurrenceStartsAt: first, slots: [] });

    const saved = await handler(
      httpEvent('PUT', `/schedule/teams/${teamId}/lineup`, {
        headers: { authorization: admin.authorization },
        body: {
          eventId,
          occurrenceStartsAt: first,
          slots: [{ userId: player.userId, position: 'Fly-half' }],
        },
      }),
    );
    expect(saved.statusCode).toBe(200);

    const loaded = await handler(
      httpEvent('GET', `/schedule/teams/${teamId}/lineup`, {
        headers: { authorization: admin.authorization },
        query: { eventId, occurrenceStartsAt: first },
      }),
    );
    expect(bodyOf(loaded).slots).toEqual([{ userId: player.userId, position: 'Fly-half' }]);

    const previous = await handler(
      httpEvent('GET', `/schedule/teams/${teamId}/lineup`, {
        headers: { authorization: admin.authorization },
        query: { eventId, occurrenceStartsAt: second, source: 'previous' },
      }),
    );
    expect(bodyOf(previous).slots).toEqual([{ userId: player.userId, position: 'Fly-half' }]);

    const forbidden = await handler(
      httpEvent('PUT', `/schedule/teams/${teamId}/lineup`, {
        headers: { authorization: player.authorization },
        body: {
          eventId,
          occurrenceStartsAt: first,
          slots: [],
        },
      }),
    );
    expect(forbidden.statusCode).toBe(403);

    const duplicate = await handler(
      httpEvent('PUT', `/schedule/teams/${teamId}/lineup`, {
        headers: { authorization: admin.authorization },
        body: {
          eventId,
          occurrenceStartsAt: first,
          slots: [
            { userId: player.userId, position: 'Fly-half' },
            { userId: player.userId, position: 'Wing' },
          ],
        },
      }),
    );
    expect(duplicate.statusCode).toBe(400);

    const practice = await handler(
      httpEvent('POST', `/schedule/teams/${teamId}/events`, {
        headers: { authorization: admin.authorization },
        body: {
          eventType: 'practice',
          title: 'Practice',
          startsAt: '2026-09-07T17:00:00.000Z',
        },
      }),
    );
    const practiceId = bodyOf(practice).eventId as string;
    const notAGame = await handler(
      httpEvent('GET', `/schedule/teams/${teamId}/lineup`, {
        headers: { authorization: admin.authorization },
        query: { eventId: practiceId, occurrenceStartsAt: '2026-09-07T17:00:00.000Z' },
      }),
    );
    expect(notAGame.statusCode).toBe(400);
    expect(bodyOf(notAGame).error).toBe('not_a_game');
  });

  it('offers seats and moves a rider when they claim a second car', async () => {
    const admin = authFor();
    const driver = authFor();
    const other = authFor();
    const rider = authFor();
    const extra = authFor();
    const teamId = seedTeam({ userId: admin.userId, role: 'team_admin' });
    for (const user of [driver, other, rider, extra]) {
      store.set(itemKey(teamPk(teamId), teamMemberSk(user.userId)), {
        [TABLE_PK]: teamPk(teamId),
        [TABLE_SK]: teamMemberSk(user.userId),
        userId: user.userId,
        role: 'player',
        joinedAt: new Date().toISOString(),
      });
    }
    const created = await handler(
      httpEvent('POST', `/schedule/teams/${teamId}/events`, {
        headers: { authorization: admin.authorization },
        body: {
          eventType: 'practice',
          title: 'Tuesday practice',
          startsAt: '2026-09-08T22:00:00.000Z',
        },
      }),
    );
    expect(created.statusCode).toBe(201);
    const eventId = bodyOf(created).eventId as string;
    const occurrenceStartsAt = '2026-09-08T22:00:00.000Z';
    const query = { eventId, occurrenceStartsAt };

    const empty = await handler(
      httpEvent('GET', `/schedule/teams/${teamId}/carpool`, {
        headers: { authorization: rider.authorization },
        query,
      }),
    );
    expect(empty.statusCode).toBe(200);
    expect(bodyOf(empty).offers).toEqual([]);

    const offered = await handler(
      httpEvent('PUT', `/schedule/teams/${teamId}/carpool`, {
        headers: { authorization: driver.authorization },
        body: { ...query, seats: 1 },
      }),
    );
    expect(offered.statusCode).toBe(200);
    expect(bodyOf(offered).offers).toEqual([{ userId: driver.userId, seats: 1, riderIds: [] }]);

    const claimed = await handler(
      httpEvent('PUT', `/schedule/teams/${teamId}/carpool/claim`, {
        headers: { authorization: rider.authorization },
        body: { ...query, driverUserId: driver.userId },
      }),
    );
    expect(claimed.statusCode).toBe(200);
    const claimedOffers = bodyOf(claimed).offers as Array<{ riderIds: string[] }>;
    expect(claimedOffers[0]?.riderIds).toEqual([rider.userId]);

    const full = await handler(
      httpEvent('PUT', `/schedule/teams/${teamId}/carpool/claim`, {
        headers: { authorization: extra.authorization },
        body: { ...query, driverUserId: driver.userId },
      }),
    );
    expect(full.statusCode).toBe(400);
    expect(bodyOf(full).error).toBe('carpool_full');

    const own = await handler(
      httpEvent('PUT', `/schedule/teams/${teamId}/carpool/claim`, {
        headers: { authorization: driver.authorization },
        body: { ...query, driverUserId: driver.userId },
      }),
    );
    expect(own.statusCode).toBe(400);
    expect(bodyOf(own).error).toBe('carpool_own_offer');

    await handler(
      httpEvent('PUT', `/schedule/teams/${teamId}/carpool`, {
        headers: { authorization: other.authorization },
        body: { ...query, seats: 2 },
      }),
    );
    const moved = await handler(
      httpEvent('PUT', `/schedule/teams/${teamId}/carpool/claim`, {
        headers: { authorization: rider.authorization },
        body: { ...query, driverUserId: other.userId },
      }),
    );
    expect(moved.statusCode).toBe(200);
    const offers = bodyOf(moved).offers as Array<{ userId: string; riderIds: string[] }>;
    expect(offers.find((offer) => offer.userId === driver.userId)?.riderIds).toEqual([]);
    expect(offers.find((offer) => offer.userId === other.userId)?.riderIds).toEqual([rider.userId]);
  });

  it('opens a carpool chat for the driver and riders, then adds the next rider to it', async () => {
    const admin = authFor();
    const driver = authFor();
    const first = authFor();
    const second = authFor();
    const teamId = seedTeam({ userId: admin.userId, role: 'team_admin' });
    for (const user of [driver, first, second]) {
      store.set(itemKey(teamPk(teamId), teamMemberSk(user.userId)), {
        [TABLE_PK]: teamPk(teamId),
        [TABLE_SK]: teamMemberSk(user.userId),
        userId: user.userId,
        role: 'player',
        joinedAt: new Date().toISOString(),
      });
    }
    const created = await handler(
      httpEvent('POST', `/schedule/teams/${teamId}/events`, {
        headers: { authorization: admin.authorization },
        body: {
          eventType: 'practice',
          title: 'Saturday practice',
          startsAt: '2026-09-12T15:00:00.000Z',
        },
      }),
    );
    const eventId = bodyOf(created).eventId as string;
    const query = { eventId, occurrenceStartsAt: '2026-09-12T15:00:00.000Z' };
    await handler(
      httpEvent('PUT', `/schedule/teams/${teamId}/carpool`, {
        headers: { authorization: driver.authorization },
        body: { ...query, seats: 2 },
      }),
    );

    const claimed = await handler(
      httpEvent('PUT', `/schedule/teams/${teamId}/carpool/claim`, {
        headers: { authorization: first.authorization },
        body: { ...query, driverUserId: driver.userId },
      }),
    );
    expect(claimed.statusCode).toBe(200);
    const chats = [...store.values()].filter((item) => item[TABLE_SK] === chatMetaSk() && item.kind === 'private');
    expect(chats).toHaveLength(1);
    const chatId = String(chats[0]?.chatId);
    const members = (userId: string): boolean =>
      store.has(itemKey(chatPk(chatId), chatMemberSk(userId))) &&
      store.has(itemKey(userPk(userId), userChatSk(chatId)));
    expect(members(driver.userId)).toBe(true);
    expect(members(first.userId)).toBe(true);

    const joined = await handler(
      httpEvent('PUT', `/schedule/teams/${teamId}/carpool/claim`, {
        headers: { authorization: second.authorization },
        body: { ...query, driverUserId: driver.userId },
      }),
    );
    expect(joined.statusCode).toBe(200);
    const still = [...store.values()].filter((item) => item[TABLE_SK] === chatMetaSk() && item.kind === 'private');
    expect(still.map((item) => item.chatId)).toEqual([chatId]);
    expect(members(second.userId)).toBe(true);

    const left = await handler(
      httpEvent('PUT', `/schedule/teams/${teamId}/carpool/claim`, {
        headers: { authorization: first.authorization },
        body: { ...query, driverUserId: driver.userId },
      }),
    );
    expect(left.statusCode).toBe(200);
    expect(store.has(itemKey(chatPk(chatId), chatMemberSk(first.userId)))).toBe(false);
    expect(store.has(itemKey(userPk(first.userId), userChatSk(chatId)))).toBe(false);
    expect(members(driver.userId)).toBe(true);
    expect(members(second.userId)).toBe(true);
  });

  it('adds a minor rider’s guardian to the carpool chat', async () => {
    const admin = authFor();
    const driver = authFor();
    const rider = authFor();
    const guardian = authFor();
    const teamId = seedTeam({ userId: admin.userId, role: 'team_admin' });
    for (const user of [driver, rider]) {
      store.set(itemKey(teamPk(teamId), teamMemberSk(user.userId)), {
        [TABLE_PK]: teamPk(teamId),
        [TABLE_SK]: teamMemberSk(user.userId),
        userId: user.userId,
        role: 'player',
        joinedAt: new Date().toISOString(),
      });
    }
    store.set(itemKey(userPk(rider.userId), profileSk()), {
      [TABLE_PK]: userPk(rider.userId),
      [TABLE_SK]: profileSk(),
      userId: rider.userId,
      accountKind: 'minor',
    });
    store.set(itemKey(userPk(rider.userId), guardianSk(guardian.userId)), {
      [TABLE_PK]: userPk(rider.userId),
      [TABLE_SK]: guardianSk(guardian.userId),
      adultId: guardian.userId,
    });
    const created = await handler(
      httpEvent('POST', `/schedule/teams/${teamId}/events`, {
        headers: { authorization: admin.authorization },
        body: {
          eventType: 'practice',
          title: 'Saturday practice',
          startsAt: '2026-09-12T15:00:00.000Z',
        },
      }),
    );
    const eventId = bodyOf(created).eventId as string;
    const query = { eventId, occurrenceStartsAt: '2026-09-12T15:00:00.000Z' };
    await handler(
      httpEvent('PUT', `/schedule/teams/${teamId}/carpool`, {
        headers: { authorization: driver.authorization },
        body: { ...query, seats: 2 },
      }),
    );
    const claimed = await handler(
      httpEvent('PUT', `/schedule/teams/${teamId}/carpool/claim`, {
        headers: { authorization: rider.authorization },
        body: { ...query, driverUserId: driver.userId },
      }),
    );
    expect(claimed.statusCode).toBe(200);
    const chat = [...store.values()].find((item) => item[TABLE_SK] === chatMetaSk() && item.kind === 'private');
    const chatId = String(chat?.chatId);
    expect(store.has(itemKey(chatPk(chatId), chatMemberSk(guardian.userId)))).toBe(true);
    expect(store.has(itemKey(userPk(guardian.userId), userChatSk(chatId)))).toBe(true);
  });
});

describe('shared fixtures', () => {
  const kickoff = '2026-10-03T18:00:00.000Z';

  const createGame = async (
    auth: { authorization: string },
    teamId: string,
    side: 'home' | 'away',
    opponentName: string,
  ) => {
    const created = await handler(
      httpEvent('POST', `/schedule/teams/${teamId}/events`, {
        headers: { authorization: auth.authorization },
        body: gameBody(side, opponentName),
      }),
    );
    expect(created.statusCode).toBe(201);
    return bodyOf(created);
  };

  it('keeps an away game as a name until the other club is on GamePlan', async () => {
    const admin = authFor();
    const teamId = seedTeam({ userId: admin.userId, role: 'team_admin', name: 'Pigs' });
    const game = await createGame(admin, teamId, 'away', 'Seacoast');
    expect(game.side).toBe('away');
    expect(game.opponentName).toBe('Seacoast');
    expect(game.fixtureId).toBeUndefined();
    const listed = await handler(
      httpEvent('GET', `/schedule/teams/${teamId}`, {
        headers: { authorization: admin.authorization },
        query: { from: '2026-10-01T00:00:00.000Z', to: '2026-10-31T00:00:00.000Z' },
      }),
    );
    const occurrences = bodyOf(listed).occurrences as Array<{ opponentName?: string; fixtureId?: string }>;
    expect(occurrences[0]?.opponentName).toBe('Seacoast');
    expect(occurrences[0]?.fixtureId).toBeUndefined();
  });

  it('lets a member with manage_events share, and refuses one without it', async () => {
    const admin = authFor();
    const coach = authFor();
    const player = authFor();
    const homeId = seedTeam({ userId: admin.userId, role: 'team_admin', name: 'Pigs', sport: 'rugby' });
    seedMember(homeId, coach.userId, 'coach');
    seedMember(homeId, player.userId, 'player');
    const awayId = seedTeam({ userId: authFor().userId, role: 'team_admin', name: 'Seacoast', sport: 'rugby' });
    const game = await createGame(admin, homeId, 'away', 'Seacoast');
    const refusedPlayer = await handler(
      httpEvent('POST', `/schedule/teams/${homeId}/events/${game.eventId as string}/fixture`, {
        headers: { authorization: player.authorization },
        body: { teamId: awayId },
      }),
    );
    expect(refusedPlayer.statusCode).toBe(403);
    const refusedCoach = await handler(
      httpEvent('POST', `/schedule/teams/${homeId}/events/${game.eventId as string}/fixture`, {
        headers: { authorization: coach.authorization },
        body: { teamId: awayId },
      }),
    );
    expect(refusedCoach.statusCode).toBe(403);
    store.set(itemKey(teamPk(homeId), rolePermissionsSk('coach')), {
      [TABLE_PK]: teamPk(homeId),
      [TABLE_SK]: rolePermissionsSk('coach'),
      role: 'coach',
      permissions: ['manage_events'],
    });
    const shared = await handler(
      httpEvent('POST', `/schedule/teams/${homeId}/events/${game.eventId as string}/fixture`, {
        headers: { authorization: coach.authorization },
        body: { teamId: awayId },
      }),
    );
    expect(shared.statusCode).toBe(201);
    expect(bodyOf(shared).status).toBe('proposed');
    expect(bodyOf(shared).awayTeamId).toBe(homeId);
  });

  it('rejects a share when the clubs play different sports', async () => {
    const admin = authFor();
    const homeId = seedTeam({ userId: admin.userId, role: 'team_admin', name: 'Pigs', sport: 'rugby' });
    const awayId = seedTeam({ userId: authFor().userId, role: 'team_admin', name: 'Kickers', sport: 'soccer' });
    const game = await createGame(admin, homeId, 'home', 'Kickers');
    const shared = await handler(
      httpEvent('POST', `/schedule/teams/${homeId}/events/${game.eventId as string}/fixture`, {
        headers: { authorization: admin.authorization },
        body: { teamId: awayId },
      }),
    );
    expect(shared.statusCode).toBe(409);
    expect(bodyOf(shared).error).toBe('sport_mismatch');
  });

  it('accepts onto a new event or an existing one, then moves both calendars', async () => {
    const homeAdmin = authFor();
    const awayAdmin = authFor();
    const awayCoach = authFor();
    const awayPlayer = authFor();
    const homeId = seedTeam({ userId: homeAdmin.userId, role: 'team_admin', name: 'Pigs', sport: 'rugby' });
    const awayId = seedTeam({
      userId: awayAdmin.userId,
      role: 'team_admin',
      name: 'Seacoast',
      sport: 'rugby',
      permissions: { ...DEFAULT_ROLE_PERMISSIONS, coach: ['manage_events'] },
    });
    seedMember(awayId, awayCoach.userId, 'coach');
    seedMember(awayId, awayPlayer.userId, 'player');
    const homeGame = await createGame(homeAdmin, homeId, 'home', 'Seacoast');
    const proposed = await handler(
      httpEvent('POST', `/schedule/teams/${homeId}/events/${homeGame.eventId as string}/fixture`, {
        headers: { authorization: homeAdmin.authorization },
        body: { teamId: awayId },
      }),
    );
    const fixtureId = bodyOf(proposed).fixtureId as string;
    const accepted = await handler(
      httpEvent('POST', `/schedule/fixtures/${fixtureId}/accept`, {
        headers: { authorization: awayCoach.authorization },
        body: {},
      }),
    );
    expect(accepted.statusCode).toBe(200);
    const linked = bodyOf(accepted);
    expect(linked.status).toBe('linked');
    expect(linked.chatId).toEqual(expect.any(String));
    const chatId = linked.chatId as string;
    expect(store.get(itemKey(chatPk(chatId), chatMetaSk()))?.kind).toBe('fixture');
    expect(store.has(itemKey(chatPk(chatId), chatMemberSk(awayCoach.userId)))).toBe(true);
    expect(store.has(itemKey(chatPk(chatId), chatMemberSk(homeAdmin.userId)))).toBe(true);
    expect(store.has(itemKey(chatPk(chatId), chatMemberSk(awayPlayer.userId)))).toBe(false);

    const moved = await handler(
      httpEvent('PATCH', `/schedule/fixtures/${fixtureId}`, {
        headers: { authorization: awayAdmin.authorization },
        body: { startsAt: '2026-10-03T19:00:00.000Z' },
      }),
    );
    expect(moved.statusCode).toBe(200);
    const homeEvent = store.get(itemKey(teamPk(homeId), eventSk(homeGame.eventId as string)));
    const awayEventId = bodyOf(moved).awayEventId as string;
    const awayEvent = store.get(itemKey(teamPk(awayId), eventSk(awayEventId)));
    expect(homeEvent?.startsAt).toBe('2026-10-03T19:00:00.000Z');
    expect(awayEvent?.startsAt).toBe('2026-10-03T19:00:00.000Z');
    expect(homeEvent?.opponentName).toBe('Seacoast');
    expect(awayEvent?.side).toBe('away');
  });

  it('attaches an away game that was scheduled first', async () => {
    const homeAdmin = authFor();
    const awayAdmin = authFor();
    const homeId = seedTeam({ userId: homeAdmin.userId, role: 'team_admin', name: 'Pigs' });
    const awayId = seedTeam({ userId: awayAdmin.userId, role: 'team_admin', name: 'Seacoast' });
    const awayGame = await createGame(awayAdmin, awayId, 'away', 'Pigs');
    const proposed = await handler(
      httpEvent('POST', `/schedule/teams/${awayId}/events/${awayGame.eventId as string}/fixture`, {
        headers: { authorization: awayAdmin.authorization },
        body: { teamId: homeId },
      }),
    );
    expect(bodyOf(proposed).status).toBe('proposed');
    const fixtureId = bodyOf(proposed).fixtureId as string;
    const homeGame = await createGame(homeAdmin, homeId, 'home', 'Seacoast');
    const accepted = await handler(
      httpEvent('POST', `/schedule/fixtures/${fixtureId}/accept`, {
        headers: { authorization: homeAdmin.authorization },
        body: { eventId: homeGame.eventId },
      }),
    );
    expect(accepted.statusCode).toBe(200);
    expect(bodyOf(accepted).homeEventId).toBe(homeGame.eventId);
    expect(bodyOf(accepted).awayEventId).toBe(awayGame.eventId);
    const homeEvents = [...store.values()].filter(
      (item) => item.teamId === homeId && String(item[TABLE_SK]).startsWith('EVT#'),
    );
    expect(homeEvents).toHaveLength(1);
  });

  it('declines a proposal and unlinks a shared game without deleting either calendar row', async () => {
    const homeAdmin = authFor();
    const awayAdmin = authFor();
    const homeId = seedTeam({ userId: homeAdmin.userId, role: 'team_admin', name: 'Pigs' });
    const awayId = seedTeam({ userId: awayAdmin.userId, role: 'team_admin', name: 'Seacoast' });
    const homeGame = await createGame(homeAdmin, homeId, 'home', 'Seacoast');
    const proposed = await handler(
      httpEvent('POST', `/schedule/teams/${homeId}/events/${homeGame.eventId as string}/fixture`, {
        headers: { authorization: homeAdmin.authorization },
        body: { teamId: awayId },
      }),
    );
    const declinedId = bodyOf(proposed).fixtureId as string;
    const declined = await handler(
      httpEvent('POST', `/schedule/fixtures/${declinedId}/decline`, {
        headers: { authorization: awayAdmin.authorization },
      }),
    );
    expect(declined.statusCode).toBe(204);
    expect(store.has(itemKey(fixturePk(declinedId), fixtureMetaSk()))).toBe(false);
    expect(store.get(itemKey(teamPk(homeId), eventSk(homeGame.eventId as string)))?.fixtureId).toBeUndefined();
    expect(store.has(itemKey(teamPk(awayId), fixtureInviteSk(declinedId)))).toBe(false);

    const again = await createGame(homeAdmin, homeId, 'home', 'Seacoast');
    const shared = await handler(
      httpEvent('POST', `/schedule/teams/${homeId}/events/${again.eventId as string}/fixture`, {
        headers: { authorization: homeAdmin.authorization },
        body: { teamId: awayId },
      }),
    );
    const fixtureId = bodyOf(shared).fixtureId as string;
    await handler(
      httpEvent('POST', `/schedule/fixtures/${fixtureId}/accept`, {
        headers: { authorization: awayAdmin.authorization },
        body: {},
      }),
    );
    const awayEventId = store.get(itemKey(fixturePk(fixtureId), fixtureMetaSk()))?.awayEventId as string;
    const unlinked = await handler(
      httpEvent('DELETE', `/schedule/fixtures/${fixtureId}`, {
        headers: { authorization: homeAdmin.authorization },
      }),
    );
    expect(unlinked.statusCode).toBe(204);
    expect(store.has(itemKey(fixturePk(fixtureId), fixtureMetaSk()))).toBe(false);
    expect(store.has(itemKey(teamPk(homeId), fixtureLinkSk(fixtureId)))).toBe(false);
    expect(store.get(itemKey(teamPk(homeId), eventSk(again.eventId as string)))?.opponentName).toBe('Seacoast');
    expect(store.get(itemKey(teamPk(awayId), eventSk(awayEventId)))?.fixtureId).toBeUndefined();
    expect(store.get(itemKey(teamPk(homeId), eventSk(again.eventId as string)))?.startsAt).toBe(kickoff);
  });
});

describe('mapScheduleError', () => {
  it('maps schedule domain errors', async () => {
    const { mapScheduleError } = await import('./routes/errors.js');
    expect(mapScheduleError('nope')).toBeUndefined();
    expect(mapScheduleError(new Error('token_expired'))?.statusCode).toBe(401);
    expect(mapScheduleError(new Error('event_not_found'))?.statusCode).toBe(404);
    expect(mapScheduleError(new Error('forbidden'))?.statusCode).toBe(403);
    expect(mapScheduleError(new Error('invalid_window'))?.statusCode).toBe(400);
    const conditional = new Error('ConditionalCheckFailed');
    conditional.name = 'ConditionalCheckFailedException';
    expect(mapScheduleError(conditional)?.statusCode).toBe(409);
    expect(mapScheduleError(new Error('occurrence_not_found'))?.statusCode).toBe(404);
    expect(mapScheduleError(new Error('unknown'))).toBeUndefined();
  });
});
