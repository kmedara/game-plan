/**
 * Member route coverage for optional profile payloads.
 */

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserProfileItem } from '../../../lib/auth/identity-provider.js';
import { issueLocalTokens } from '../../../lib/auth/local-jwt.js';
import { TABLE_PK, TABLE_SK, profileSk, rolePermissionsSk, teamMemberSk, teamMetaSk, teamPk, userPk } from '../../../lib/dynamo/keys.js';
import type { TeamMemberItem } from '../team-store.js';
import { DEFAULT_ROLE_PERMISSIONS } from '@gameplan/types';

const { store, itemKey, assignMemberRole, getProfileMock } = vi.hoisted(() => {
  const store = new Map<string, Record<string, unknown>>();
  const itemKey = (pk: string, sk: string): string => `${pk}\0${sk}`;
  const assignMemberRole = vi.fn(async (..._args: unknown[]): Promise<TeamMemberItem> => ({
    PK: 'PK',
    SK: 'SK',
    userId: 'member',
    role: 'coach',
    joinedAt: new Date().toISOString(),
  }));
  const getProfileMock = vi.fn(
    async (..._args: unknown[]): Promise<UserProfileItem | undefined> => undefined,
  );
  return { store, itemKey, assignMemberRole, getProfileMock };
});

vi.mock('../../../lib/dynamo/access.js', () => ({
  getItem: async <T extends Record<string, unknown>>(pk: string, sk: string) =>
    store.get(itemKey(pk, sk)) as T | undefined,
  putItem: async (item: Record<string, unknown>): Promise<void> => {
    store.set(itemKey(String(item[TABLE_PK]), String(item[TABLE_SK])), item);
  },
  transactWrite: async (
    items: Array<{ Put?: { Item: Record<string, unknown> } }>,
  ): Promise<void> => {
    for (const entry of items) {
      if (entry.Put?.Item !== undefined) {
        const item = entry.Put.Item;
        store.set(itemKey(String(item[TABLE_PK]), String(item[TABLE_SK])), item);
      }
    }
  },
  queryBySkPrefix: async <T extends Record<string, unknown>>(pk: string, skPrefix: string) => {
    const items: T[] = [];
    for (const [key, item] of store) {
      const [itemPk, itemSk] = key.split('\0');
      if (itemPk === pk && itemSk?.startsWith(skPrefix)) items.push(item as T);
    }
    return items;
  },
  queryPage: async () => ({ items: [] }),
  queryAll: async () => [],
  queryPartition: async () => [],
  encodeCursor: () => undefined,
  decodeCursor: () => undefined,
}));

vi.mock('../../../lib/auth/profile.js', () => ({
  getProfile: (...args: unknown[]) => getProfileMock(...args),
  toUserProfile: (item: Record<string, unknown>) => item,
}));

vi.mock('../team-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../team-store.js')>();
  return {
    ...actual,
    assignMemberRole: (...args: unknown[]) => assignMemberRole(...args),
  };
});

const { handler } = await import('../handler.js');

const httpEvent = (
  method: string,
  path: string,
  options: { body?: unknown; headers?: Record<string, string> } = {},
): APIGatewayProxyEventV2 =>
  ({
    version: '2.0',
    rawPath: path,
    headers: options.headers ?? {},
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    requestContext: { http: { method, path } },
  }) as APIGatewayProxyEventV2;

describe('handleGetMember', () => {
  beforeEach(() => {
    store.clear();
    getProfileMock.mockReset();
    getProfileMock.mockResolvedValue(undefined);
    process.env.LOCAL_JWT_SECRET = 'members-route-test';
  });

  afterEach(() => {
    store.clear();
  });

  it('returns a roster member profile for another teammate', async () => {
    const viewerId = randomUUID();
    const memberId = randomUUID();
    const teamId = randomUUID();
    const { accessToken } = issueLocalTokens(viewerId, `${viewerId}@example.com`);

    store.set(itemKey(teamPk(teamId), teamMetaSk()), {
      [TABLE_PK]: teamPk(teamId),
      [TABLE_SK]: teamMetaSk(),
      teamId,
      name: 'Hawks',
      timeZone: 'UTC',
      defaultChatId: randomUUID(),
      createdBy: viewerId,
      createdAt: new Date().toISOString(),
    });
    store.set(itemKey(teamPk(teamId), teamMemberSk(viewerId)), {
      [TABLE_PK]: teamPk(teamId),
      [TABLE_SK]: teamMemberSk(viewerId),
      userId: viewerId,
      role: 'coach',
      joinedAt: new Date().toISOString(),
    });
    store.set(itemKey(teamPk(teamId), teamMemberSk(memberId)), {
      [TABLE_PK]: teamPk(teamId),
      [TABLE_SK]: teamMemberSk(memberId),
      userId: memberId,
      role: 'player',
      joinedAt: new Date().toISOString(),
      positions: ['Wing'],
    });
    getProfileMock.mockResolvedValueOnce({
      PK: userPk(memberId),
      SK: profileSk(),
      userId: memberId,
      email: `${memberId}@example.com`,
      displayName: 'Pat Player',
      accountKind: 'adult',
      phoneNumber: '+12025550123',
      photoKey: `uploads/${memberId}/photo`,
      createdAt: new Date().toISOString(),
    });

    const result = await handler(
      httpEvent('GET', `/teams/${teamId}/members/${memberId}`, {
        headers: { authorization: `Bearer ${accessToken}` },
      }),
    );
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body ?? '')).toMatchObject({
      userId: memberId,
      role: 'player',
      roles: ['player'],
      positions: ['Wing'],
      displayName: 'Pat Player',
      phoneNumber: '+12025550123',
      photoKey: `uploads/${memberId}/photo`,
    });
  });

  it('returns 404 when the target is not on the roster', async () => {
    const viewerId = randomUUID();
    const teamId = randomUUID();
    const { accessToken } = issueLocalTokens(viewerId, `${viewerId}@example.com`);

    store.set(itemKey(teamPk(teamId), teamMetaSk()), {
      [TABLE_PK]: teamPk(teamId),
      [TABLE_SK]: teamMetaSk(),
      teamId,
      name: 'Hawks',
      timeZone: 'UTC',
      defaultChatId: randomUUID(),
      createdBy: viewerId,
      createdAt: new Date().toISOString(),
    });
    store.set(itemKey(teamPk(teamId), teamMemberSk(viewerId)), {
      [TABLE_PK]: teamPk(teamId),
      [TABLE_SK]: teamMemberSk(viewerId),
      userId: viewerId,
      role: 'coach',
      joinedAt: new Date().toISOString(),
    });

    const result = await handler(
      httpEvent('GET', `/teams/${teamId}/members/${randomUUID()}`, {
        headers: { authorization: `Bearer ${accessToken}` },
      }),
    );
    expect(result.statusCode).toBe(404);
  });
});

describe('handleListMembers', () => {
  beforeEach(() => {
    store.clear();
    getProfileMock.mockReset();
    process.env.LOCAL_JWT_SECRET = 'members-route-test';
  });

  afterEach(() => {
    store.clear();
  });

  it('returns photo, positions, and phone, hiding a minor phone from non-guardians', async () => {
    const viewerId = randomUUID();
    const adultId = randomUUID();
    const minorId = randomUUID();
    const guardedId = randomUUID();
    const teamId = randomUUID();
    const { accessToken } = issueLocalTokens(viewerId, `${viewerId}@example.com`);
    const joinedAt = new Date().toISOString();
    for (const [userId, role] of [
      [viewerId, 'coach'],
      [adultId, 'player'],
      [minorId, 'player'],
      [guardedId, 'player'],
    ] as const) {
      store.set(itemKey(teamPk(teamId), teamMemberSk(userId)), {
        [TABLE_PK]: teamPk(teamId),
        [TABLE_SK]: teamMemberSk(userId),
        userId,
        role,
        joinedAt,
        ...(userId === adultId ? { positions: ['Wing'] } : {}),
      });
    }
    store.set(itemKey(userPk(guardedId), `GUARDIAN#${viewerId}`), { adultId: viewerId });
    getProfileMock.mockImplementation(async (...args: unknown[]) => {
      const userId = String(args[0]);
      return {
        PK: userPk(userId),
        SK: profileSk(),
        userId,
        email: `${userId}@example.com`,
        displayName: userId,
        accountKind: userId === minorId || userId === guardedId ? 'minor' : 'adult',
        phoneNumber: '+12025550123',
        photoKey: `uploads/${userId}/photo`,
        createdAt: joinedAt,
      };
    });

    const result = await handler(
      httpEvent('GET', `/teams/${teamId}/members`, {
        headers: { authorization: `Bearer ${accessToken}` },
      }),
    );
    expect(result.statusCode).toBe(200);
    const { members } = JSON.parse(result.body ?? '') as { members: Array<Record<string, unknown>> };
    const byId = new Map(members.map((member) => [member.userId, member]));
    expect(byId.get(adultId)).toMatchObject({
      positions: ['Wing'],
      phoneNumber: '+12025550123',
      photoKey: `uploads/${adultId}/photo`,
    });
    expect(byId.get(minorId)?.phoneNumber).toBeUndefined();
    expect(byId.get(minorId)?.photoKey).toBe(`uploads/${minorId}/photo`);
    expect(byId.get(guardedId)?.phoneNumber).toBe('+12025550123');
  });
});

describe('handleAssignRole', () => {
  beforeEach(() => {
    store.clear();
    assignMemberRole.mockClear();
    process.env.LOCAL_JWT_SECRET = 'members-route-test';
  });

  afterEach(() => {
    store.clear();
  });

  it('assigns a role after the caller outranks the target', async () => {
    const adminId = randomUUID();
    const memberId = randomUUID();
    const teamId = randomUUID();
    const { accessToken } = issueLocalTokens(adminId, `${adminId}@example.com`);

    store.set(itemKey(teamPk(teamId), teamMetaSk()), {
      [TABLE_PK]: teamPk(teamId),
      [TABLE_SK]: teamMetaSk(),
      teamId,
      name: 'Hawks',
      timeZone: 'UTC',
      defaultChatId: randomUUID(),
      createdBy: adminId,
      createdAt: new Date().toISOString(),
    });
    store.set(itemKey(teamPk(teamId), teamMemberSk(adminId)), {
      [TABLE_PK]: teamPk(teamId),
      [TABLE_SK]: teamMemberSk(adminId),
      userId: adminId,
      role: 'team_admin',
      joinedAt: new Date().toISOString(),
    });
    store.set(itemKey(teamPk(teamId), teamMemberSk(memberId)), {
      [TABLE_PK]: teamPk(teamId),
      [TABLE_SK]: teamMemberSk(memberId),
      userId: memberId,
      role: 'player',
      joinedAt: new Date().toISOString(),
    });
    getProfileMock.mockResolvedValue({
      PK: userPk(memberId),
      SK: profileSk(),
      userId: memberId,
      email: `${memberId}@example.com`,
      displayName: 'Pat Player',
      accountKind: 'adult',
      createdAt: new Date().toISOString(),
    });
    for (const role of Object.keys(DEFAULT_ROLE_PERMISSIONS)) {
      store.set(itemKey(teamPk(teamId), rolePermissionsSk(role)), {
        [TABLE_PK]: teamPk(teamId),
        [TABLE_SK]: rolePermissionsSk(role),
        role,
        permissions: [...DEFAULT_ROLE_PERMISSIONS[role as keyof typeof DEFAULT_ROLE_PERMISSIONS]],
      });
    }

    assignMemberRole.mockResolvedValueOnce({
      [TABLE_PK]: teamPk(teamId),
      [TABLE_SK]: teamMemberSk(memberId),
      userId: memberId,
      role: 'coach',
      roles: ['coach', 'parent'],
      joinedAt: new Date().toISOString(),
    });

    const result = await handler(
      httpEvent('PATCH', `/teams/${teamId}/members/${memberId}`, {
        headers: { authorization: `Bearer ${accessToken}` },
        body: { roles: ['parent', 'coach'] },
      }),
    );
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body ?? '{}') as Record<string, unknown>;
    expect(body.userId).toBe(memberId);
    expect(body.role).toBe('coach');
    expect(body.roles).toEqual(['coach', 'parent']);
    expect(assignMemberRole).toHaveBeenCalledWith(teamId, memberId, ['parent', 'coach']);
    expect(body.user).toMatchObject({ displayName: 'Pat Player' });
  });

  it('rejects a duplicate role and a set the caller cannot grant', async () => {
    const coachId = randomUUID();
    const adminId = randomUUID();
    const teamId = randomUUID();
    const { accessToken } = issueLocalTokens(coachId, `${coachId}@example.com`);

    store.set(itemKey(teamPk(teamId), teamMetaSk()), {
      [TABLE_PK]: teamPk(teamId),
      [TABLE_SK]: teamMetaSk(),
      teamId,
      name: 'Hawks',
      timeZone: 'UTC',
      defaultChatId: randomUUID(),
      createdBy: coachId,
      createdAt: new Date().toISOString(),
    });
    store.set(itemKey(teamPk(teamId), teamMemberSk(coachId)), {
      [TABLE_PK]: teamPk(teamId),
      [TABLE_SK]: teamMemberSk(coachId),
      userId: coachId,
      role: 'coach',
      roles: ['coach'],
      joinedAt: new Date().toISOString(),
    });
    store.set(itemKey(teamPk(teamId), teamMemberSk(adminId)), {
      [TABLE_PK]: teamPk(teamId),
      [TABLE_SK]: teamMemberSk(adminId),
      userId: adminId,
      role: 'team_admin',
      joinedAt: new Date().toISOString(),
    });
    for (const role of Object.keys(DEFAULT_ROLE_PERMISSIONS)) {
      const permissions =
        role === 'coach'
          ? ['assign_roles']
          : [...DEFAULT_ROLE_PERMISSIONS[role as keyof typeof DEFAULT_ROLE_PERMISSIONS]];
      store.set(itemKey(teamPk(teamId), rolePermissionsSk(role)), {
        [TABLE_PK]: teamPk(teamId),
        [TABLE_SK]: rolePermissionsSk(role),
        role,
        permissions,
      });
    }

    const duplicate = await handler(
      httpEvent('PATCH', `/teams/${teamId}/members/${adminId}`, {
        headers: { authorization: `Bearer ${accessToken}` },
        body: { roles: ['player', 'player'] },
      }),
    );
    expect(duplicate.statusCode).toBe(400);

    const outranked = await handler(
      httpEvent('PATCH', `/teams/${teamId}/members/${adminId}`, {
        headers: { authorization: `Bearer ${accessToken}` },
        body: { roles: ['player'] },
      }),
    );
    expect(outranked.statusCode).toBe(403);
    expect(JSON.parse(outranked.body ?? '')).toEqual({ error: 'role_outranks_caller' });
    expect(assignMemberRole).not.toHaveBeenCalled();
  });

  it('hides a minor phone number from a teammate who is not the guardian', async () => {
    const viewerId = randomUUID();
    const memberId = randomUUID();
    const teamId = randomUUID();
    const { accessToken } = issueLocalTokens(viewerId, `${viewerId}@example.com`);
    store.set(itemKey(teamPk(teamId), teamMetaSk()), {
      [TABLE_PK]: teamPk(teamId),
      [TABLE_SK]: teamMetaSk(),
      teamId,
      name: 'Hawks',
      timeZone: 'UTC',
      defaultChatId: randomUUID(),
      createdBy: viewerId,
      createdAt: new Date().toISOString(),
    });
    store.set(itemKey(teamPk(teamId), teamMemberSk(viewerId)), {
      [TABLE_PK]: teamPk(teamId),
      [TABLE_SK]: teamMemberSk(viewerId),
      userId: viewerId,
      role: 'coach',
      joinedAt: new Date().toISOString(),
    });
    store.set(itemKey(teamPk(teamId), teamMemberSk(memberId)), {
      [TABLE_PK]: teamPk(teamId),
      [TABLE_SK]: teamMemberSk(memberId),
      userId: memberId,
      role: 'player',
      joinedAt: new Date().toISOString(),
    });
    getProfileMock.mockResolvedValueOnce({
      PK: userPk(memberId),
      SK: profileSk(),
      userId: memberId,
      email: `${memberId}@example.com`,
      displayName: 'Kid',
      accountKind: 'minor',
      phoneNumber: '+12025550123',
      createdAt: new Date().toISOString(),
    });

    const result = await handler(
      httpEvent('GET', `/teams/${teamId}/members/${memberId}`, {
        headers: { authorization: `Bearer ${accessToken}` },
      }),
    );
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body ?? '') as Record<string, unknown>;
    expect(body.phoneNumber).toBeUndefined();
    expect(body.accountKind).toBe('minor');
  });
});
