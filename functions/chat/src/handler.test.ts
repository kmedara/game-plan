/**
 * Chat Lambda HTTP coverage with an in-memory DynamoDB store.
 */

import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryTable } from '../../lib/dynamo/memory-table.js';
import { issueLocalTokens } from '../../lib/auth/local-jwt.js';
import type { AccountKind, TeamPermission, TeamRole } from '@gameplan/types';
import { DEFAULT_ROLE_PERMISSIONS } from '@gameplan/types';
import {
  TABLE_PK,
  TABLE_SK,
  chatMemberSk,
  guardianSk,
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

const { store, itemKey } = memoryTable;
const emailIndex = new Map<string, { PK: string; SK: string }>();


vi.mock('../../lib/dynamo/access.js', async () => (await import('../../lib/dynamo/memory-table.js')).memoryAccess);

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
  firstName?: string;
  lastName?: string;
  photoKey?: string;
  birthday?: string;
  phoneNumber?: string;
}): void => {
  const email = input.email.trim().toLowerCase();
  store.set(itemKey(userPk(input.userId), profileSk()), {
    [TABLE_PK]: userPk(input.userId),
    [TABLE_SK]: profileSk(),
    userId: input.userId,
    email,
    displayName: input.displayName ?? 'Player',
    ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
    ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
    accountKind: input.accountKind,
    createdAt: new Date().toISOString(),
    ...(input.photoKey !== undefined ? { photoKey: input.photoKey } : {}),
    ...(input.birthday !== undefined ? { birthday: input.birthday } : {}),
    ...(input.phoneNumber !== undefined ? { phoneNumber: input.phoneNumber } : {}),
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

  it('rejects channel creation for a team the caller is not on', async () => {
    const caller = authFor();
    const other = authFor();
    seedProfile({
      userId: caller.userId,
      email: `${caller.userId}@example.com`,
      accountKind: 'adult',
    });
    seedProfile({
      userId: other.userId,
      email: `${other.userId}@example.com`,
      accountKind: 'adult',
    });
    seedTeam({ members: [{ userId: caller.userId, role: 'team_admin' }] });
    const { teamId: otherTeamId } = seedTeam({
      members: [{ userId: other.userId, role: 'team_admin' }],
    });

    const result = await handler(
      httpEvent('POST', '/chat/channels', {
        headers: { authorization: caller.authorization },
        body: { teamId: otherTeamId, name: 'Parents' },
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

  it('stores the name on a private chat with teammates', async () => {
    const a = authFor();
    const b = authFor();
    seedProfile({ userId: a.userId, email: `${a.userId}@example.com`, accountKind: 'adult' });
    seedProfile({ userId: b.userId, email: `${b.userId}@example.com`, accountKind: 'adult' });
    seedTeam({
      members: [
        { userId: a.userId, role: 'coach' },
        { userId: b.userId, role: 'player' },
      ],
    });

    const result = await handler(
      httpEvent('POST', '/chat/private', {
        headers: { authorization: a.authorization },
        body: { memberIds: [b.userId], name: 'Ride home' },
      }),
    );
    expect(result.statusCode).toBe(201);
    expect(JSON.parse(result.body ?? '')).toMatchObject({ kind: 'private', name: 'Ride home' });
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

  it('adds the linked guardian when an adult messages a minor', async () => {
    const minor = authFor();
    const coach = authFor();
    const guardian = authFor();
    seedProfile({ userId: minor.userId, email: `${minor.userId}@example.com`, accountKind: 'minor' });
    seedProfile({ userId: coach.userId, email: `${coach.userId}@example.com`, accountKind: 'adult' });
    seedProfile({
      userId: guardian.userId,
      email: `${guardian.userId}@example.com`,
      accountKind: 'adult',
    });
    const { teamId } = seedTeam({
      members: [
        { userId: minor.userId, role: 'player' },
        { userId: coach.userId, role: 'coach' },
        { userId: guardian.userId, role: 'parent' },
      ],
    });
    store.set(itemKey(userPk(minor.userId), guardianSk(guardian.userId)), {
      [TABLE_PK]: userPk(minor.userId),
      [TABLE_SK]: guardianSk(guardian.userId),
      minorId: minor.userId,
      adultId: guardian.userId,
    });

    const result = await handler(
      httpEvent('POST', '/chat/private', {
        headers: { authorization: coach.authorization },
        body: { memberIds: [minor.userId] },
      }),
    );
    expect(result.statusCode).toBe(201);
    const chatId = (JSON.parse(result.body ?? '') as { chatId: string }).chatId;
    expect(store.has(itemKey(chatPk(chatId), chatMemberSk(guardian.userId)))).toBe(true);
    expect(teamId).toBeDefined();
  });
});

describe('teammate search', () => {
  /**
   * Searches as the caller and returns the matching user ids.
   *
   * @param authorization - The caller's bearer header.
   * @param q - The typed query.
   * @returns The status code and the users in response order.
   */
  const searchAs = async (
    authorization: string,
    q: string,
  ): Promise<{ statusCode: number | undefined; users: Array<Record<string, unknown>> }> => {
    const result = await handler(
      httpEvent('GET', '/chat/users/search', { headers: { authorization }, query: { q } }),
    );
    const body = JSON.parse(result.body ?? '{}') as { users?: Array<Record<string, unknown>> };
    return { statusCode: result.statusCode, users: body.users ?? [] };
  };

  it('finds teammates by first or last name, without phone or birthday', async () => {
    const caller = authFor();
    const adaId = randomUUID();
    const grace = randomUUID();
    seedProfile({ userId: caller.userId, email: `${caller.userId}@example.com`, accountKind: 'adult' });
    seedProfile({
      userId: adaId,
      email: `${adaId}@example.com`,
      accountKind: 'adult',
      displayName: 'Ada Lovelace',
      firstName: 'Ada',
      lastName: 'Lovelace',
      birthday: '1990-04-02',
      phoneNumber: '+15555550123',
    });
    seedProfile({
      userId: grace,
      email: `${grace}@example.com`,
      accountKind: 'adult',
      displayName: 'Grace Hopper',
      firstName: 'Grace',
      lastName: 'Hopper',
    });
    seedTeam({
      members: [
        { userId: caller.userId, role: 'player' },
        { userId: adaId, role: 'player' },
        { userId: grace, role: 'coach' },
      ],
    });

    const byFirst = await searchAs(caller.authorization, 'ada');
    expect(byFirst.statusCode).toBe(200);
    expect(byFirst.users).toEqual([
      expect.objectContaining({ userId: adaId, displayName: 'Ada Lovelace', firstName: 'Ada', lastName: 'Lovelace' }),
    ]);
    expect(byFirst.users[0]).not.toHaveProperty('birthday');
    expect(byFirst.users[0]).not.toHaveProperty('phoneNumber');
    expect(byFirst.users[0]).not.toHaveProperty('needsProfileCompletion');

    expect((await searchAs(caller.authorization, 'HOP')).users.map((user) => user.userId)).toEqual([grace]);
    expect((await searchAs(caller.authorization, 'ada lov')).users.map((user) => user.userId)).toEqual([adaId]);
    expect((await searchAs(caller.authorization, 'ace')).users).toEqual([]);
  });

  it('copies profile names onto older roster rows the first time it reads them', async () => {
    const caller = authFor();
    const adaId = randomUUID();
    seedProfile({ userId: caller.userId, email: `${caller.userId}@example.com`, accountKind: 'adult' });
    seedProfile({
      userId: adaId,
      email: `${adaId}@example.com`,
      accountKind: 'adult',
      displayName: 'Ada Lovelace',
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
    const { teamId } = seedTeam({
      members: [
        { userId: caller.userId, role: 'player' },
        { userId: adaId, role: 'coach' },
      ],
    });
    const rowKey = itemKey(teamPk(teamId), teamMemberSk(adaId));
    expect(store.get(rowKey)).not.toHaveProperty('displayName');

    await searchAs(caller.authorization, 'ada');
    expect(store.get(rowKey)).toMatchObject({
      userId: adaId,
      role: 'coach',
      displayName: 'Ada Lovelace',
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
  });

  it('reads names from the roster row without loading the profile', async () => {
    const caller = authFor();
    const named = randomUUID();
    seedProfile({ userId: caller.userId, email: `${caller.userId}@example.com`, accountKind: 'adult' });
    const { teamId } = seedTeam({
      members: [
        { userId: caller.userId, role: 'player' },
        { userId: named, role: 'player' },
      ],
    });
    store.set(itemKey(teamPk(teamId), teamMemberSk(named)), {
      ...store.get(itemKey(teamPk(teamId), teamMemberSk(named))),
      displayName: 'Roster Name',
      firstName: 'Roster',
      lastName: 'Name',
    });

    const { users } = await searchAs(caller.authorization, 'roster');
    expect(users).toEqual([
      { userId: named, displayName: 'Roster Name', firstName: 'Roster', lastName: 'Name', teamIds: [teamId] },
    ]);
  });

  it('searches every team the caller is on, once per person, never the caller', async () => {
    const caller = authFor();
    const shared = randomUUID();
    const other = randomUUID();
    seedProfile({ userId: caller.userId, email: `${caller.userId}@example.com`, accountKind: 'adult', displayName: 'Sam Searcher' });
    seedProfile({ userId: shared, email: `${shared}@example.com`, accountKind: 'minor', displayName: 'Sam Shared' });
    seedProfile({ userId: other, email: `${other}@example.com`, accountKind: 'adult', displayName: 'Sam Other' });
    seedTeam({ members: [{ userId: caller.userId, role: 'coach' }, { userId: shared, role: 'player' }] });
    seedTeam({
      members: [
        { userId: caller.userId, role: 'coach' },
        { userId: shared, role: 'player' },
        { userId: other, role: 'player' },
      ],
    });

    const { users } = await searchAs(caller.authorization, 'sam');
    expect(users.map((user) => user.userId)).toEqual([other, shared]);
  });

  it('does not find people outside the caller teams', async () => {
    const caller = authFor();
    const stranger = randomUUID();
    seedProfile({ userId: caller.userId, email: `${caller.userId}@example.com`, accountKind: 'adult' });
    seedProfile({ userId: stranger, email: `${stranger}@example.com`, accountKind: 'adult', displayName: 'Stranger Danger' });
    seedTeam({ members: [{ userId: caller.userId, role: 'player' }] });
    seedTeam({ members: [{ userId: stranger, role: 'player' }] });

    expect(await searchAs(caller.authorization, 'stranger')).toEqual({ statusCode: 200, users: [] });
  });

  it('rejects a query shorter than two characters', async () => {
    const caller = authFor();
    expect((await searchAs(caller.authorization, ' a ')).statusCode).toBe(400);
  });
});

describe('messages', () => {
  it('persists a message and lists history newest first', async () => {
    const { authorization, userId } = authFor();
    seedProfile({
      userId,
      email: `${userId}@example.com`,
      accountKind: 'adult',
      displayName: 'Ada Player',
      photoKey: `uploads/${userId}/photo`,
    });
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
    expect(JSON.parse(first.body ?? '')).toMatchObject({
      body: 'first',
      senderDisplayName: 'Ada Player',
      senderPhotoKey: `uploads/${userId}/photo`,
    });

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
    const page = JSON.parse(list.body ?? '') as {
      messages: Array<{ body: string; senderDisplayName: string; senderPhotoKey?: string }>;
    };
    expect(page.messages.map((m) => m.body)).toEqual(['second', 'first']);
    expect(page.messages[0]).toMatchObject({
      senderDisplayName: 'Ada Player',
      senderPhotoKey: `uploads/${userId}/photo`,
    });
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

  it('sorts chats by kind and name, paginates messages, and sends attachments', async () => {
    const { authorization, userId } = authFor();
    seedProfile({
      userId,
      email: `${userId}@example.com`,
      accountKind: 'adult',
      displayName: 'Ada Player',
    });
    const { teamId, defaultChatId } = seedTeam({
      members: [{ userId, role: 'team_admin' }],
    });

    const alpha = await handler(
      httpEvent('POST', '/chat/channels', {
        headers: { authorization },
        body: { teamId, name: 'Alpha channel' },
      }),
    );
    const zulu = await handler(
      httpEvent('POST', '/chat/channels', {
        headers: { authorization },
        body: { teamId, name: 'Zulu channel' },
      }),
    );
    expect(alpha.statusCode).toBe(201);
    expect(zulu.statusCode).toBe(201);
    const alphaId = (JSON.parse(alpha.body ?? '') as { chatId: string }).chatId;
    const zuluId = (JSON.parse(zulu.body ?? '') as { chatId: string }).chatId;

    const listed = await handler(httpEvent('GET', '/chat', { headers: { authorization } }));
    const chats = (JSON.parse(listed.body ?? '') as { chats: Array<{ chatId: string; name: string }> })
      .chats;
    expect(chats.map((c) => c.chatId)).toEqual([defaultChatId, alphaId, zuluId]);

    for (let i = 0; i < 3; i += 1) {
      await handler(
        httpEvent('POST', `/chat/${defaultChatId}/messages`, {
          headers: { authorization },
          body: { body: `msg-${i}` },
        }),
      );
    }
    const page = await handler(
      httpEvent('GET', `/chat/${defaultChatId}/messages`, {
        headers: { authorization },
        query: { limit: '2' },
      }),
    );
    const firstPage = JSON.parse(page.body ?? '') as {
      messages: Array<{ body: string }>;
      cursor?: string;
    };
    expect(firstPage.messages).toHaveLength(2);
    expect(firstPage.cursor).toBeDefined();

    const withAttachment = await handler(
      httpEvent('POST', `/chat/${zuluId}/messages`, {
        headers: { authorization },
        body: { body: 'photo', attachmentKeys: [`uploads/${userId}/a.png`] },
      }),
    );
    expect(withAttachment.statusCode).toBe(201);
    expect(JSON.parse(withAttachment.body ?? '')).toMatchObject({
      attachmentKeys: [`uploads/${userId}/a.png`],
    });
  });

  it('rejects a team channel when a minor fails the roster chat rule', async () => {
    const admin = authFor();
    const minor = authFor();
    seedProfile({
      userId: admin.userId,
      email: `${admin.userId}@example.com`,
      accountKind: 'adult',
    });
    seedProfile({
      userId: minor.userId,
      email: `${minor.userId}@example.com`,
      accountKind: 'minor',
    });
    const { teamId } = seedTeam({
      members: [
        { userId: admin.userId, role: 'team_admin' },
        { userId: minor.userId, role: 'player' },
      ],
    });
    store.delete(itemKey(userPk(minor.userId), userTeamSk(teamId)));

    const result = await handler(
      httpEvent('POST', '/chat/channels', {
        headers: { authorization: admin.authorization },
        body: { teamId, name: 'Broken channel' },
      }),
    );
    expect(result.statusCode).toBe(403);
    expect(JSON.parse(result.body ?? '')).toEqual({ error: 'minor_chat_rule_violated' });
  });

  it('returns not found for unknown chats and bare route prefixes', async () => {
    const { authorization } = authFor();
    expect(
      (await handler(httpEvent('GET', `/chat/${randomUUID()}/messages`, { headers: { authorization } })))
        .statusCode,
    ).toBe(403);
    expect((await handler(httpEvent('GET', 'users/search', { headers: { authorization } }))).statusCode).toBe(
      400,
    );
    expect((await handler(httpEvent('POST', '/chat/unknown-route', { headers: { authorization } }))).statusCode).toBe(
      404,
    );
    expect((await handler(httpEvent('GET', '/health'))).statusCode).toBe(200);
    expect((await handler(httpEvent('GET', '///'))).statusCode).toBe(401);
    expect((await handler(httpEvent('GET', 'no-leading-slash'))).statusCode).toBe(404);
    expect(
      (await handler(httpEvent('GET', '/users/search', { headers: { authorization } }))).statusCode,
    ).toBe(400);
    expect(
      (
        await handler({
          version: '2.0',
          requestContext: { http: { method: 'GET', path: '/chat' } },
        } as APIGatewayProxyEventV2)
      ).statusCode,
    ).toBe(401);
  });
});


