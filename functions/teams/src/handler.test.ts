/**
 * Teams Lambda HTTP coverage with an in-memory DynamoDB and profile store.
 */

import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountKind } from '@gameplan/types';
import type { UserProfileItem } from '../../lib/auth/identity-provider.js';
import { issueLocalTokens } from '../../lib/auth/local-jwt.js';
import { TABLE_PK, TABLE_SK, chatMetaSk, chatPk } from '../../lib/dynamo/keys.js';

const store = new Map<string, Record<string, unknown>>();
const profiles = new Map<string, UserProfileItem>();

const itemKey = (pk: string, sk: string): string => `${pk}\0${sk}`;

vi.mock('../../lib/auth/profile.js', () => ({
  getProfile: async (userId: string) => profiles.get(userId),
  putProfile: async () => {
    throw new Error('not_used');
  },
}));

vi.mock('../../lib/dynamo/access.js', () => ({
  getItem: async <T extends Record<string, unknown>>(
    pk: string,
    sk: string,
  ): Promise<T | undefined> => store.get(itemKey(pk, sk)) as T | undefined,
  putItem: async (
    item: Record<string, unknown>,
    options: {
      conditionExpression?: string;
    } = {},
  ): Promise<void> => {
    const pk = String(item[TABLE_PK]);
    const sk = String(item[TABLE_SK]);
    const key = itemKey(pk, sk);
    if (options.conditionExpression?.includes('attribute_not_exists') && store.has(key)) {
      const error = new Error(' ConditionalCheckFailed');
      error.name = 'ConditionalCheckFailedException';
      throw error;
    }
    store.set(key, item);
  },
  deleteItem: async (pk: string, sk: string): Promise<void> => {
    store.delete(itemKey(pk, sk));
  },
  transactWrite: async (
    items: Array<{
      Put?: {
        Item: Record<string, unknown>;
        ConditionExpression?: string;
      };
      Delete?: { Key: Record<string, unknown> };
    }>,
  ): Promise<void> => {
    for (const entry of items) {
      if (entry.Put !== undefined) {
        const item = entry.Put.Item;
        const pk = String(item[TABLE_PK]);
        const sk = String(item[TABLE_SK]);
        const key = itemKey(pk, sk);
        if (
          entry.Put.ConditionExpression?.includes('attribute_not_exists') &&
          store.has(key)
        ) {
          const error = new Error('Transaction cancelled');
          error.name = 'TransactionCanceledException';
          throw error;
        }
        store.set(key, item);
      }
      if (entry.Delete !== undefined) {
        const pk = String(entry.Delete.Key[TABLE_PK]);
        const sk = String(entry.Delete.Key[TABLE_SK]);
        store.delete(itemKey(pk, sk));
      }
    }
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
  queryAll: async () => [],
  queryPage: async <T extends Record<string, unknown>>(
    input: {
      KeyConditionExpression?: string;
      ExpressionAttributeValues?: Record<string, unknown>;
    },
    options: { limit: number; cursor?: string },
  ): Promise<{ items: T[]; cursor?: string }> => {
    const pk = String(input.ExpressionAttributeValues?.[':pk'] ?? '');
    const skPrefix = String(input.ExpressionAttributeValues?.[':skPrefix'] ?? '');
    const needle = input.ExpressionAttributeValues?.[':needle'];
    const all: T[] = [];
    for (const [key, item] of store) {
      const [itemPk, itemSk] = key.split('\0');
      if (itemPk !== pk || !itemSk.startsWith(skPrefix)) continue;
      if (typeof needle === 'string' && !String(item.nameSearch ?? '').includes(needle)) {
        continue;
      }
      all.push(item as T);
    }
    const start = options.cursor !== undefined ? Number(options.cursor) : 0;
    const end = start + options.limit;
    return {
      items: all.slice(start, end),
      ...(end < all.length ? { cursor: String(end) } : {}),
    };
  },
  queryPartition: async () => [],
  encodeCursor: () => undefined,
  decodeCursor: () => undefined,
}));

const { handler } = await import('./handler.js');

/**
 * Builds a minimal HTTP API event for teams routes.
 *
 * @param method - The HTTP method.
 * @param path - The request path, including `/teams`.
 * @param options - Optional body and headers.
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
 * Seeds a profile and returns a bearer Authorization header.
 *
 * @param accountKind - Adult or minor.
 * @param displayName - Display name for the profile.
 * @returns Auth header and user id.
 */
const seedUser = (
  accountKind: AccountKind,
  displayName: string,
): { authorization: string; userId: string } => {
  const userId = randomUUID();
  const email = `${userId}@example.com`;
  profiles.set(userId, {
    PK: `USER#${userId}`,
    SK: 'PROFILE',
    userId,
    email,
    displayName,
    accountKind,
    createdAt: new Date().toISOString(),
  });
  const { accessToken } = issueLocalTokens(userId, email);
  return { authorization: `Bearer ${accessToken}`, userId };
};

/**
 * Parses a JSON response body.
 *
 * @param result - A structured proxy result.
 * @returns The parsed body.
 */
const bodyOf = (result: { body?: string }): Record<string, unknown> =>
  JSON.parse(result.body ?? '{}') as Record<string, unknown>;

describe('teams handler (in-memory)', () => {
  beforeEach(() => {
    store.clear();
    profiles.clear();
    delete process.env.COGNITO_USER_POOL_ID;
    delete process.env.COGNITO_CLIENT_ID;
    process.env.LOCAL_JWT_SECRET = 'teams-handler-test-secret';
  });

  afterEach(() => {
    store.clear();
    profiles.clear();
  });

  it('creates a team with default chat and admin permissions', async () => {
    const admin = seedUser('adult', 'Admin Ada');

    const created = await handler(
      httpEvent('POST', '/teams', {
        headers: { authorization: admin.authorization },
        body: { name: 'U12 Hawks', timeZone: 'America/New_York' },
      }),
    );
    expect(created.statusCode).toBe(201);
    const team = bodyOf(created);
    expect(team).toMatchObject({
      name: 'U12 Hawks',
      timeZone: 'America/New_York',
      role: 'team_admin',
    });
    expect(typeof team.teamId).toBe('string');
    expect(typeof team.defaultChatId).toBe('string');
    expect(store.get(itemKey(chatPk(String(team.defaultChatId)), chatMetaSk()))).toMatchObject({
      name: 'U12 Hawks',
      kind: 'default',
    });

    const listed = await handler(
      httpEvent('GET', '/teams', { headers: { authorization: admin.authorization } }),
    );
    expect(listed.statusCode).toBe(200);
    expect(bodyOf(listed).teams).toHaveLength(1);

    const directory = await handler(
      httpEvent('GET', '/teams/directory', {
        headers: { authorization: admin.authorization },
        query: { q: 'hawks' },
      }),
    );
    expect(directory.statusCode).toBe(200);
    expect(bodyOf(directory).teams).toEqual([
      expect.objectContaining({
        teamId: team.teamId,
        name: 'U12 Hawks',
        timeZone: 'America/New_York',
      }),
    ]);

    const permissions = await handler(
      httpEvent('GET', `/teams/${team.teamId}/permissions`, {
        headers: { authorization: admin.authorization },
      }),
    );
    expect(permissions.statusCode).toBe(200);
    const matrix = bodyOf(permissions).roles as Array<{
      role: string;
      permissions: string[];
    }>;
    const adminRole = matrix.find((row) => row.role === 'team_admin');
    expect(adminRole?.permissions).toContain('manage_permissions');
    expect(adminRole?.permissions).toContain('invite_members');
  });

  it('rejects team creation by a minor', async () => {
    const minor = seedUser('minor', 'Kid');
    const result = await handler(
      httpEvent('POST', '/teams', {
        headers: { authorization: minor.authorization },
        body: { name: 'Nope', timeZone: 'America/New_York' },
      }),
    );
    expect(result.statusCode).toBe(403);
    expect(bodyOf(result)).toEqual({ error: 'minor_cannot_create_team' });
  });

  it('covers invites, join requests, role assign, and permission updates', async () => {
    const admin = seedUser('adult', 'Admin');
    const invitee = seedUser('adult', 'Invitee');
    const requester = seedUser('adult', 'Requester');
    const minor = seedUser('minor', 'Player Kid');

    const created = await handler(
      httpEvent('POST', '/teams', {
        headers: { authorization: admin.authorization },
        body: { name: 'Rockets', timeZone: 'America/New_York' },
      }),
    );
    const teamId = bodyOf(created).teamId as string;

    const invite = await handler(
      httpEvent('POST', `/teams/${teamId}/invites`, {
        headers: { authorization: admin.authorization },
        body: { role: 'coach' },
      }),
    );
    expect(invite.statusCode).toBe(201);
    const code = bodyOf(invite).code as string;

    const preview = await handler(
      httpEvent('GET', `/teams/invite/${code}`, {
        headers: { authorization: invitee.authorization },
      }),
    );
    expect(preview.statusCode).toBe(200);
    expect(bodyOf(preview)).toMatchObject({ teamId, role: 'coach', teamName: 'Rockets' });

    const accepted = await handler(
      httpEvent('POST', `/teams/invite/${code}/accept`, {
        headers: { authorization: invitee.authorization },
      }),
    );
    expect(accepted.statusCode).toBe(200);
    expect(bodyOf(accepted)).toMatchObject({ teamId, role: 'coach' });

    const join = await handler(
      httpEvent('POST', `/teams/${teamId}/join-requests`, {
        headers: { authorization: requester.authorization },
      }),
    );
    expect(join.statusCode).toBe(201);
    const requestId = bodyOf(join).requestId as string;

    await handler(
      httpEvent('PUT', `/teams/${teamId}/permissions`, {
        headers: { authorization: admin.authorization },
        body: {
          roles: [
            {
              role: 'team_admin',
              permissions: [
                'manage_permissions',
                'invite_members',
                'approve_join_requests',
                'assign_roles',
                'manage_events',
                'create_team_channels',
              ],
            },
            { role: 'coach', permissions: ['approve_join_requests', 'assign_roles'] },
          ],
        },
      }),
    );

    const approved = await handler(
      httpEvent('POST', `/teams/${teamId}/join-requests/${requestId}/approve`, {
        headers: { authorization: admin.authorization },
        body: { role: 'parent' },
      }),
    );
    expect(approved.statusCode).toBe(200);
    expect(bodyOf(approved)).toMatchObject({ userId: requester.userId, role: 'parent' });

    const members = await handler(
      httpEvent('GET', `/teams/${teamId}/members`, {
        headers: { authorization: admin.authorization },
      }),
    );
    expect(members.statusCode).toBe(200);
    expect((bodyOf(members).members as unknown[]).length).toBe(3);

    const assigned = await handler(
      httpEvent('PATCH', `/teams/${teamId}/members/${requester.userId}`, {
        headers: { authorization: admin.authorization },
        body: { role: 'player' },
      }),
    );
    expect(assigned.statusCode).toBe(200);
    expect(bodyOf(assigned)).toMatchObject({ role: 'player' });

    const minorJoin = await handler(
      httpEvent('POST', `/teams/${teamId}/join-requests`, {
        headers: { authorization: minor.authorization },
      }),
    );
    const minorRequestId = bodyOf(minorJoin).requestId as string;
    const minorAdmin = await handler(
      httpEvent('POST', `/teams/${teamId}/join-requests/${minorRequestId}/approve`, {
        headers: { authorization: admin.authorization },
        body: { role: 'team_admin' },
      }),
    );
    expect(minorAdmin.statusCode).toBe(403);
    expect(bodyOf(minorAdmin)).toEqual({ error: 'minor_cannot_be_team_admin' });

    const stripManage = await handler(
      httpEvent('PUT', `/teams/${teamId}/permissions`, {
        headers: { authorization: admin.authorization },
        body: {
          roles: [{ role: 'team_admin', permissions: ['invite_members'] }],
        },
      }),
    );
    expect(stripManage.statusCode).toBe(400);
    expect(bodyOf(stripManage)).toEqual({
      error: 'manage_permissions_required_for_team_admin',
    });
  });

  it('updates team name, time zone, and location for an admin', async () => {
    const admin = seedUser('adult', 'Admin Ada');
    const coach = seedUser('adult', 'Coach Cam');

    const created = await handler(
      httpEvent('POST', '/teams', {
        headers: { authorization: admin.authorization },
        body: { name: 'U12 Hawks', timeZone: 'America/New_York' },
      }),
    );
    const createdBody = bodyOf(created);
    const teamId = createdBody.teamId as string;
    const defaultChatId = createdBody.defaultChatId as string;

    const updated = await handler(
      httpEvent('PATCH', `/teams/${teamId}`, {
        headers: { authorization: admin.authorization },
        body: {
          name: 'Eastside United',
          timeZone: 'America/Chicago',
          location: 'Peoria, IL',
        },
      }),
    );
    expect(updated.statusCode).toBe(200);
    expect(bodyOf(updated)).toMatchObject({
      teamId,
      name: 'Eastside United',
      timeZone: 'America/Chicago',
      location: 'Peoria, IL',
      role: 'team_admin',
    });
    expect(store.get(itemKey(chatPk(defaultChatId), chatMetaSk()))).toMatchObject({
      name: 'Eastside United',
    });

    const loaded = await handler(
      httpEvent('GET', `/teams/${teamId}`, {
        headers: { authorization: admin.authorization },
      }),
    );
    expect(bodyOf(loaded)).toMatchObject({
      name: 'Eastside United',
      timeZone: 'America/Chicago',
      location: 'Peoria, IL',
    });

    const directory = await handler(
      httpEvent('GET', '/teams/directory', {
        headers: { authorization: admin.authorization },
        query: { q: 'eastside' },
      }),
    );
    expect(bodyOf(directory).teams).toEqual([
      expect.objectContaining({
        teamId,
        name: 'Eastside United',
        timeZone: 'America/Chicago',
        location: 'Peoria, IL',
      }),
    ]);

    const oldName = await handler(
      httpEvent('GET', '/teams/directory', {
        headers: { authorization: admin.authorization },
        query: { q: 'hawks' },
      }),
    );
    expect(bodyOf(oldName).teams).toEqual([]);

    const cleared = await handler(
      httpEvent('PATCH', `/teams/${teamId}`, {
        headers: { authorization: admin.authorization },
        body: { location: null },
      }),
    );
    expect(cleared.statusCode).toBe(200);
    expect(bodyOf(cleared).location).toBeUndefined();

    const invite = await handler(
      httpEvent('POST', `/teams/${teamId}/invites`, {
        headers: { authorization: admin.authorization },
        body: { role: 'coach' },
      }),
    );
    const code = bodyOf(invite).code as string;
    await handler(
      httpEvent('POST', `/teams/invite/${code}/accept`, {
        headers: { authorization: coach.authorization },
      }),
    );
    const denied = await handler(
      httpEvent('PATCH', `/teams/${teamId}`, {
        headers: { authorization: coach.authorization },
        body: { name: 'Nope' },
      }),
    );
    expect(denied.statusCode).toBe(403);

    const empty = await handler(
      httpEvent('PATCH', `/teams/${teamId}`, {
        headers: { authorization: admin.authorization },
        body: {},
      }),
    );
    expect(empty.statusCode).toBe(400);
  });

  it('stores and clears a team theme', async () => {
    const admin = seedUser('adult', 'Ada');
    const created = await handler(
      httpEvent('POST', '/teams', {
        headers: { authorization: admin.authorization },
        body: { name: 'U12 Hawks', timeZone: 'America/New_York' },
      }),
    );
    const teamId = bodyOf(created).teamId as string;
    const theme = {
      primary: '#7c2d12',
      secondary: '#1e40af',
      accent: '#f59e0b',
      logoKey: 'uploads/admin/logo',
    };

    const updated = await handler(
      httpEvent('PATCH', `/teams/${teamId}`, {
        headers: { authorization: admin.authorization },
        body: { theme },
      }),
    );
    expect(updated.statusCode).toBe(200);
    expect(bodyOf(updated).theme).toEqual(theme);

    const renamed = await handler(
      httpEvent('PATCH', `/teams/${teamId}`, {
        headers: { authorization: admin.authorization },
        body: { name: 'Eastside United' },
      }),
    );
    expect(bodyOf(renamed).theme).toEqual(theme);

    const cleared = await handler(
      httpEvent('PATCH', `/teams/${teamId}`, {
        headers: { authorization: admin.authorization },
        body: { theme: null },
      }),
    );
    expect(cleared.statusCode).toBe(200);
    expect(bodyOf(cleared).theme).toBeUndefined();
  });

  it('stores the caller positions on a team', async () => {
    const admin = seedUser('adult', 'Ada');
    const created = await handler(
      httpEvent('POST', '/teams', {
        headers: { authorization: admin.authorization },
        body: { name: 'U12 Hawks', timeZone: 'America/New_York' },
      }),
    );
    const teamId = bodyOf(created).teamId;

    const updated = await handler(
      httpEvent('PUT', `/teams/${teamId}/positions`, {
        headers: { authorization: admin.authorization },
        body: { positions: ['Fly-half', 'fly-half', 'Wing'] },
      }),
    );
    expect(updated.statusCode).toBe(200);
    expect(bodyOf(updated).positions).toEqual(['Fly-half', 'Wing']);

    const listed = await handler(
      httpEvent('GET', '/teams', { headers: { authorization: admin.authorization } }),
    );
    const teams = bodyOf(listed).teams as Array<{ teamId: string; positions?: string[] }>;
    expect(teams).toEqual([
      expect.objectContaining({ teamId, positions: ['Fly-half', 'Wing'] }),
    ]);
  });

  it('returns health for the teams area', async () => {
    const result = await handler(httpEvent('GET', '/teams/health'));
    expect(result.statusCode).toBe(200);
    expect(bodyOf(result)).toEqual({ ok: true, service: 'teams' });
  });
});
