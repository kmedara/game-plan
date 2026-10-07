/**
 * Member route coverage for optional profile payloads.
 */

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { issueLocalTokens } from '../../../lib/auth/local-jwt.js';
import { TABLE_PK, TABLE_SK, rolePermissionsSk, teamMemberSk, teamMetaSk, teamPk } from '../../../lib/dynamo/keys.js';
import { DEFAULT_ROLE_PERMISSIONS } from '@gameplan/types';

const { store, itemKey, assignMemberRole, getProfileMock } = vi.hoisted(() => {
  const store = new Map<string, Record<string, unknown>>();
  const itemKey = (pk: string, sk: string): string => `${pk}\0${sk}`;
  const assignMemberRole = vi.fn(async () => ({
    userId: 'member',
    role: 'coach' as const,
    joinedAt: new Date().toISOString(),
  }));
  const getProfileMock = vi.fn(async () => undefined);
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
  queryBySkPrefix: async () => [],
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
      userId: memberId,
      email: `${memberId}@example.com`,
      displayName: 'Pat Player',
      accountKind: 'adult',
      phoneNumber: '555-0100',
      photoKey: `uploads/${memberId}/photo`,
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
      positions: ['Wing'],
      displayName: 'Pat Player',
      phoneNumber: '555-0100',
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

describe('handleAssignRole', () => {
  beforeEach(() => {
    store.clear();
    assignMemberRole.mockClear();
    process.env.LOCAL_JWT_SECRET = 'members-route-test';
  });

  afterEach(() => {
    store.clear();
  });

  it('returns role fields without a user block when the profile row is missing', async () => {
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
      joinedAt: new Date().toISOString(),
    });

    const result = await handler(
      httpEvent('PATCH', `/teams/${teamId}/members/${memberId}`, {
        headers: { authorization: `Bearer ${accessToken}` },
        body: { role: 'coach' },
      }),
    );
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body ?? '{}') as Record<string, unknown>;
    expect(body.userId).toBe(memberId);
    expect(body.role).toBe('coach');
    expect(body.user).toBeUndefined();
  });
});
