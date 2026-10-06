/**
 * Chat Lambda HTTP coverage with an in-memory DynamoDB store.
 */

import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { issueLocalTokens } from '../../lib/auth/local-jwt.js';
import type { AccountKind, TeamPermission, TeamRole } from '@gameplan/types';
import { DEFAULT_ROLE_PERMISSIONS } from '@gameplan/types';
import {
  TABLE_PK,
  TABLE_SK,
  chatMemberSk,
  chatMetaSk,
  chatPk,
  messageSk,
  profileSk,
  rolePermissionsSk,
  teamMemberSk,
  teamMetaSk,
  teamPk,
  userChatSk,
  userPk,
  userTeamSk,
} from '../../lib/dynamo/keys.js';

const store = new Map<string, Record<string, unknown>>();
const emailIndex = new Map<string, { PK: string; SK: string }>();

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
  transactWrite: async (
    items: Array<{ Put?: { Item: Record<string, unknown> } }>,
  ): Promise<void> => {
    for (const entry of items) {
      if (entry.Put?.Item === undefined) continue;
      const item = entry.Put.Item;
      const pk = String(item[TABLE_PK]);
      const sk = String(item[TABLE_SK]);
      store.set(itemKey(pk, sk), item);
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
  queryBySkBetween: async () => [],
  queryAll: async () => [],
  queryPage: async <T extends Record<string, unknown>>(
    input: {
      ExpressionAttributeValues?: Record<string, unknown>;
      ScanIndexForward?: boolean;
    },
    options: { limit: number; cursor?: string },
  ): Promise<{ items: T[]; cursor?: string }> => {
    const pk = String(input.ExpressionAttributeValues?.[':pk'] ?? '');
    const skPrefix = String(input.ExpressionAttributeValues?.[':skPrefix'] ?? '');
    const all: T[] = [];
    for (const [key, item] of store) {
      const [itemPk, itemSk] = key.split('\0');
      if (itemPk === pk && itemSk.startsWith(skPrefix)) all.push(item as T);
    }
    all.sort((a, b) => String(a[TABLE_SK]).localeCompare(String(b[TABLE_SK])));
    if (input.ScanIndexForward === false) all.reverse();

    const start = options.cursor !== undefined ? Number(options.cursor) : 0;
    const slice = all.slice(start, start + options.limit);
    const next = start + options.limit;
    return {
      items: slice,
      cursor: next < all.length ? String(next) : undefined,
    };
  },
  queryPartition: async () => [],
  encodeCursor: (key: Record<string, unknown> | undefined) =>
    key === undefined ? undefined : JSON.stringify(key),
  decodeCursor: (cursor?: string) =>
    cursor === undefined ? undefined : (JSON.parse(cursor) as Record<string, unknown>),
}));

vi.mock('../../lib/dynamo/client.js', () => ({
  getDocClient: () => ({
    send: async (command: { input?: { ExpressionAttributeValues?: Record<string, string> } }) => {
      const email = command.input?.ExpressionAttributeValues?.[':email'];
      if (email === undefined) return { Items: [] };
      const key = emailIndex.get(email);
      return { Items: key === undefined ? [] : [key] };
    },
  }),
  resetDocClient: (): void => undefined,
}));

vi.mock('../../lib/fanout-enqueue.js', () => ({
  enqueueFanout: async (): Promise<void> => undefined,
  resetFanoutSqsClient: (): void => undefined,
}));

const { handler } = await import('./handler.js');

/**
 * Builds a minimal HTTP API event for chat routes.
 *
 * @param method - The HTTP method.
 * @param path - The request path, including `/chat`.
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
 * Seeds a user profile and optional email index entry.
 *
 * @param input - Profile fields.
 */
const seedProfile = (input: {
  userId: string;
  email: string;
  accountKind: AccountKind;
  displayName?: string;
}): void => {
  const email = input.email.trim().toLowerCase();
  store.set(itemKey(userPk(input.userId), profileSk()), {
    [TABLE_PK]: userPk(input.userId),
    [TABLE_SK]: profileSk(),
    userId: input.userId,
    email,
    displayName: input.displayName ?? 'Player',
    accountKind: input.accountKind,
    createdAt: new Date().toISOString(),
  });
  emailIndex.set(email, { PK: userPk(input.userId), SK: profileSk() });
};

/**
 * Seeds a team with roster members and role permissions.
 *
 * @param input - Team and membership details.
 * @returns The team id and default chat id.
 */
const seedTeam = (input: {
  teamId?: string;
  members: Array<{ userId: string; role: TeamRole }>;
  permissions?: Partial<Record<TeamRole, readonly TeamPermission[]>>;
}): { teamId: string; defaultChatId: string } => {
  const teamId = input.teamId ?? randomUUID();
  const defaultChatId = randomUUID();
  const createdAt = new Date().toISOString();

  store.set(itemKey(teamPk(teamId), teamMetaSk()), {
    [TABLE_PK]: teamPk(teamId),
    [TABLE_SK]: teamMetaSk(),
    teamId,
    name: 'Hawks',
    timeZone: 'America/New_York',
    defaultChatId,
    createdBy: input.members[0]?.userId ?? randomUUID(),
    createdAt,
  });

  store.set(itemKey(chatPk(defaultChatId), chatMetaSk()), {
    [TABLE_PK]: chatPk(defaultChatId),
    [TABLE_SK]: chatMetaSk(),
    chatId: defaultChatId,
    kind: 'default',
    name: 'Team chat',
    teamId,
    createdBy: input.members[0]?.userId,
    createdAt,
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

  for (const member of input.members) {
    store.set(itemKey(teamPk(teamId), teamMemberSk(member.userId)), {
      [TABLE_PK]: teamPk(teamId),
      [TABLE_SK]: teamMemberSk(member.userId),
      userId: member.userId,
      role: member.role,
      joinedAt: createdAt,
    });
    store.set(itemKey(userPk(member.userId), userTeamSk(teamId)), {
      [TABLE_PK]: userPk(member.userId),
      [TABLE_SK]: userTeamSk(teamId),
      teamId,
      role: member.role,
      joinedAt: createdAt,
    });
    store.set(itemKey(chatPk(defaultChatId), chatMemberSk(member.userId)), {
      [TABLE_PK]: chatPk(defaultChatId),
      [TABLE_SK]: chatMemberSk(member.userId),
      userId: member.userId,
      joinedAt: createdAt,
    });
    store.set(itemKey(userPk(member.userId), userChatSk(defaultChatId)), {
      [TABLE_PK]: userPk(member.userId),
      [TABLE_SK]: userChatSk(defaultChatId),
      chatId: defaultChatId,
      kind: 'default',
      teamId,
      name: 'Team chat',
    });
  }

  return { teamId, defaultChatId };
};

beforeEach(() => {
  store.clear();
  emailIndex.clear();
  delete process.env.COGNITO_USER_POOL_ID;
  delete process.env.COGNITO_CLIENT_ID;
  process.env.LOCAL_JWT_SECRET = 'chat-handler-test-secret';
});

afterEach(() => {
  store.clear();
  emailIndex.clear();
});

describe('chat health', () => {
  it('answers GET /chat/health', async () => {
    const result = await handler(httpEvent('GET', '/chat/health'));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body ?? '')).toEqual({ ok: true, service: 'chat' });
  });
});

describe('chat channels and private chats', () => {
  it('creates a team channel when the caller has create_team_channels', async () => {
    const { authorization, userId } = authFor();
    seedProfile({ userId, email: `${userId}@example.com`, accountKind: 'adult' });
    const { teamId } = seedTeam({
      members: [{ userId, role: 'team_admin' }],
    });

    const result = await handler(
      httpEvent('POST', '/chat/channels', {
        headers: { authorization },
        body: { teamId, name: 'Parents' },
      }),
    );
    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body ?? '') as { kind: string; name: string; teamId: string };
    expect(body).toMatchObject({ kind: 'channel', name: 'Parents', teamId });
  });

  it('rejects channel creation without create_team_channels', async () => {
    const { authorization, userId } = authFor();
    seedProfile({ userId, email: `${userId}@example.com`, accountKind: 'adult' });
    const { teamId } = seedTeam({
      members: [{ userId, role: 'player' }],
      permissions: { ...DEFAULT_ROLE_PERMISSIONS, player: [] },
    });

    const result = await handler(
      httpEvent('POST', '/chat/channels', {
        headers: { authorization },
        body: { teamId, name: 'Parents' },
      }),
    );
    expect(result.statusCode).toBe(403);
  });

  it('creates a private chat between adults on different teams', async () => {
    const a = authFor();
    const b = authFor();
    seedProfile({ userId: a.userId, email: `${a.userId}@example.com`, accountKind: 'adult' });
    seedProfile({ userId: b.userId, email: `${b.userId}@example.com`, accountKind: 'adult' });
    seedTeam({ members: [{ userId: a.userId, role: 'coach' }] });
    seedTeam({ members: [{ userId: b.userId, role: 'coach' }] });

    const result = await handler(
      httpEvent('POST', '/chat/private', {
        headers: { authorization: a.authorization },
        body: { memberIds: [b.userId] },
      }),
    );
    expect(result.statusCode).toBe(201);
    expect(JSON.parse(result.body ?? '')).toMatchObject({ kind: 'private' });
  });

  it('rejects a private chat that puts a minor with an outsider', async () => {
    const minor = authFor();
    const outsider = authFor();
    seedProfile({
      userId: minor.userId,
      email: `${minor.userId}@example.com`,
      accountKind: 'minor',
    });
    seedProfile({
      userId: outsider.userId,
      email: `${outsider.userId}@example.com`,
      accountKind: 'adult',
    });
    seedTeam({ members: [{ userId: minor.userId, role: 'player' }] });
    seedTeam({ members: [{ userId: outsider.userId, role: 'coach' }] });

    const result = await handler(
      httpEvent('POST', '/chat/private', {
        headers: { authorization: minor.authorization },
        body: { memberIds: [outsider.userId] },
      }),
    );
    expect(result.statusCode).toBe(403);
    expect(JSON.parse(result.body ?? '')).toEqual({ error: 'minor_chat_rule_violated' });
  });
});

describe('adult search', () => {
  it('returns an adult by exact email', async () => {
    const caller = authFor();
    const targetId = randomUUID();
    const email = `adult-${targetId}@example.com`;
    seedProfile({ userId: caller.userId, email: `${caller.userId}@example.com`, accountKind: 'adult' });
    seedProfile({
      userId: targetId,
      email,
      accountKind: 'adult',
      displayName: 'Ada Adult',
    });

    const result = await handler(
      httpEvent('GET', '/chat/users/search', {
        headers: { authorization: caller.authorization },
        query: { email },
      }),
    );
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body ?? '')).toMatchObject({
      user: { userId: targetId, email, displayName: 'Ada Adult', accountKind: 'adult' },
    });
  });

  it('hides minors from search', async () => {
    const caller = authFor();
    const minorId = randomUUID();
    const email = `minor-${minorId}@example.com`;
    seedProfile({ userId: caller.userId, email: `${caller.userId}@example.com`, accountKind: 'adult' });
    seedProfile({ userId: minorId, email, accountKind: 'minor' });

    const result = await handler(
      httpEvent('GET', '/chat/users/search', {
        headers: { authorization: caller.authorization },
        query: { email },
      }),
    );
    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body ?? '')).toEqual({ error: 'user_not_found' });
  });
});

describe('messages', () => {
  it('persists a message and lists history newest first', async () => {
    const { authorization, userId } = authFor();
    seedProfile({ userId, email: `${userId}@example.com`, accountKind: 'adult' });
    const { defaultChatId } = seedTeam({
      members: [{ userId, role: 'team_admin' }],
    });

    const first = await handler(
      httpEvent('POST', `/chat/${defaultChatId}/messages`, {
        headers: { authorization },
        body: { body: 'first' },
      }),
    );
    expect(first.statusCode).toBe(201);

    // Slightly later SK so reverse order is deterministic in the in-memory store.
    const later = new Date(Date.now() + 1000).toISOString();
    const messageId = randomUUID();
    store.set(itemKey(chatPk(defaultChatId), messageSk(later, messageId)), {
      [TABLE_PK]: chatPk(defaultChatId),
      [TABLE_SK]: messageSk(later, messageId),
      messageId,
      chatId: defaultChatId,
      senderId: userId,
      body: 'second',
      createdAt: later,
    });

    const list = await handler(
      httpEvent('GET', `/chat/${defaultChatId}/messages`, {
        headers: { authorization },
        query: { limit: '10' },
      }),
    );
    expect(list.statusCode).toBe(200);
    const page = JSON.parse(list.body ?? '') as { messages: Array<{ body: string }> };
    expect(page.messages.map((m) => m.body)).toEqual(['second', 'first']);
  });

  it('lists chats for the caller', async () => {
    const { authorization, userId } = authFor();
    seedProfile({ userId, email: `${userId}@example.com`, accountKind: 'adult' });
    const { defaultChatId } = seedTeam({
      members: [{ userId, role: 'team_admin' }],
    });

    const result = await handler(
      httpEvent('GET', '/chat', { headers: { authorization } }),
    );
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body ?? '') as { chats: Array<{ chatId: string }> };
    expect(body.chats.some((c) => c.chatId === defaultChatId)).toBe(true);
  });

  it('rejects messages from non-members', async () => {
    const member = authFor();
    const outsider = authFor();
    seedProfile({
      userId: member.userId,
      email: `${member.userId}@example.com`,
      accountKind: 'adult',
    });
    seedProfile({
      userId: outsider.userId,
      email: `${outsider.userId}@example.com`,
      accountKind: 'adult',
    });
    const { defaultChatId } = seedTeam({
      members: [{ userId: member.userId, role: 'team_admin' }],
    });

    const result = await handler(
      httpEvent('POST', `/chat/${defaultChatId}/messages`, {
        headers: { authorization: outsider.authorization },
        body: { body: 'nope' },
      }),
    );
    expect(result.statusCode).toBe(403);
  });
});

