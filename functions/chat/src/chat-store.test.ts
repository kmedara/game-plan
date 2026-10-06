/**
 * Chat store coverage for sorting, attachments, and minor channel rules.
 */

import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountKind } from '@gameplan/types';
import { DEFAULT_ROLE_PERMISSIONS } from '@gameplan/types';
import {
  TABLE_PK,
  TABLE_SK,
  chatMemberSk,
  chatMetaSk,
  chatPk,
  profileSk,
  rolePermissionsSk,
  teamMemberSk,
  teamMetaSk,
  teamPk,
  messageSk,
  userChatSk,
  userPk,
} from '../../lib/dynamo/keys.js';

const store = new Map<string, Record<string, unknown>>();
const profiles = new Map<
  string,
  { userId: string; displayName: string; email: string; accountKind: AccountKind; photoKey?: string }
>();

const itemKey = (pk: string, sk: string): string => `${pk}\0${sk}`;

const findProfileByEmail = vi.fn(async () => undefined);

vi.mock('../../lib/auth/profile.js', () => ({
  getProfile: async (userId: string) => {
    const row = profiles.get(userId);
    if (row === undefined) return undefined;
    return {
      PK: userPk(userId),
      SK: profileSk(),
      userId: row.userId,
      email: row.email,
      displayName: row.displayName,
      accountKind: row.accountKind,
      createdAt: new Date().toISOString(),
      ...(row.photoKey !== undefined ? { photoKey: row.photoKey } : {}),
    };
  },
  findProfileByEmail: (...args: unknown[]) => findProfileByEmail(...args),
  toUserProfile: (item: { userId: string; email: string; displayName: string; accountKind: AccountKind }) =>
    item,
}));

vi.mock('../../lib/dynamo/access.js', () => ({
  getItem: async <T extends Record<string, unknown>>(pk: string, sk: string) =>
    store.get(itemKey(pk, sk)) as T | undefined,
  putItem: async (item: Record<string, unknown>): Promise<void> => {
    store.set(itemKey(String(item[TABLE_PK]), String(item[TABLE_SK])), item);
  },
  deleteItem: async (): Promise<void> => undefined,
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
  encodeCursor: () => undefined,
  decodeCursor: () => undefined,
}));

const fanout = vi.fn(async (): Promise<void> => undefined);
vi.mock('../../lib/fanout-enqueue.js', () => ({
  enqueueFanout: (...args: unknown[]) => fanout(...args),
  resetFanoutSqsClient: (): void => undefined,
}));

const {
  createPrivateChat,
  createTeamChannel,
  listMessages,
  listUserChats,
  requireChat,
  searchAdultByEmail,
  sendMessage,
} = await import('./chat-store.js');

const seedProfile = (
  userId: string,
  accountKind: AccountKind,
  options: { photoKey?: string } = {},
): void => {
  profiles.set(userId, {
    userId,
    email: `${userId}@example.com`,
    displayName: 'User',
    accountKind,
    ...options,
  });
};

describe('chat-store', () => {
  beforeEach(() => {
    store.clear();
    profiles.clear();
    fanout.mockClear();
  });

  afterEach(() => {
    store.clear();
    profiles.clear();
  });

  it('sorts listed chats by kind then name', async () => {
    const userId = randomUUID();
    seedProfile(userId, 'adult');
    const chats = [
      { chatId: randomUUID(), kind: 'private' as const, name: 'Zed' },
      { chatId: randomUUID(), kind: 'default' as const, name: 'Team' },
      { chatId: randomUUID(), kind: 'channel' as const, name: 'Alpha' },
    ];
    for (const chat of chats) {
      store.set(itemKey(userPk(userId), userChatSk(chat.chatId)), {
        [TABLE_PK]: userPk(userId),
        [TABLE_SK]: userChatSk(chat.chatId),
        chatId: chat.chatId,
        userId,
      });
      store.set(itemKey(chatPk(chat.chatId), chatMetaSk()), {
        [TABLE_PK]: chatPk(chat.chatId),
        [TABLE_SK]: chatMetaSk(),
        chatId: chat.chatId,
        kind: chat.kind,
        name: chat.name,
        createdAt: new Date().toISOString(),
      });
    }
    const listed = await listUserChats(userId);
    expect(listed.map((row) => row.kind)).toEqual(['default', 'channel', 'private']);
  });

  it('sendMessage stores attachment keys and forwards them to fan-out', async () => {
    const userId = randomUUID();
    const chatId = randomUUID();
    seedProfile(userId, 'adult', { photoKey: 'uploads/u/photo' });
    store.set(itemKey(chatPk(chatId), chatMetaSk()), {
      [TABLE_PK]: chatPk(chatId),
      [TABLE_SK]: chatMetaSk(),
      chatId,
      kind: 'private',
      name: 'Direct',
      createdAt: new Date().toISOString(),
    });
    store.set(itemKey(chatPk(chatId), chatMemberSk(userId)), {
      [TABLE_PK]: chatPk(chatId),
      [TABLE_SK]: chatMemberSk(userId),
      chatId,
      userId,
    });
    const message = await sendMessage({
      chatId,
      userId,
      body: { body: 'see file', attachmentKeys: ['uploads/u/file.png'] },
    });
    expect(message.attachmentKeys).toEqual(['uploads/u/file.png']);
    expect(fanout).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentKeys: ['uploads/u/file.png'],
        senderPhotoKey: 'uploads/u/photo',
      }),
    );
  });

  it('createTeamChannel rejects rosters that violate minor chat rules', async () => {
    const teamId = randomUUID();
    const adminId = randomUUID();
    const minorId = randomUUID();
    seedProfile(adminId, 'adult');
    seedProfile(minorId, 'minor');
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
    for (const role of Object.keys(DEFAULT_ROLE_PERMISSIONS) as Array<
      keyof typeof DEFAULT_ROLE_PERMISSIONS
    >) {
      store.set(itemKey(teamPk(teamId), rolePermissionsSk(role)), {
        [TABLE_PK]: teamPk(teamId),
        [TABLE_SK]: rolePermissionsSk(role),
        role,
        permissions: [...DEFAULT_ROLE_PERMISSIONS[role]],
      });
    }
    for (const member of [
      { userId: adminId, role: 'team_admin' as const },
      { userId: minorId, role: 'player' as const },
    ]) {
      store.set(itemKey(teamPk(teamId), teamMemberSk(member.userId)), {
        [TABLE_PK]: teamPk(teamId),
        [TABLE_SK]: teamMemberSk(member.userId),
        userId: member.userId,
        role: member.role,
        joinedAt: new Date().toISOString(),
      });
    }
    await expect(
      createTeamChannel({
        userId: adminId,
        body: { teamId, name: 'Parents' },
      }),
    ).rejects.toThrow('minor_chat_rule_violated');
  });

  it('skips broken memberships and missing chat metadata when listing chats', async () => {
    const userId = randomUUID();
    store.set(itemKey(userPk(userId), userChatSk('bad')), {
      [TABLE_PK]: userPk(userId),
      [TABLE_SK]: userChatSk('bad'),
      chatId: 42,
    });
    store.set(itemKey(userPk(userId), userChatSk('ghost')), {
      [TABLE_PK]: userPk(userId),
      [TABLE_SK]: userChatSk('ghost'),
      chatId: 'ghost',
    });
    expect(await listUserChats(userId)).toEqual([]);
  });

  it('lists messages with sender fallback when profile is missing', async () => {
    const userId = randomUUID();
    const chatId = randomUUID();
    const createdAt = new Date().toISOString();
    const messageId = randomUUID();
    store.set(itemKey(chatPk(chatId), chatMetaSk()), {
      [TABLE_PK]: chatPk(chatId),
      [TABLE_SK]: chatMetaSk(),
      chatId,
      kind: 'private',
      name: 'Direct',
      createdAt,
    });
    store.set(itemKey(chatPk(chatId), chatMemberSk(userId)), {
      [TABLE_PK]: chatPk(chatId),
      [TABLE_SK]: chatMemberSk(userId),
      chatId,
      userId,
    });
    store.set(itemKey(chatPk(chatId), messageSk(createdAt, messageId)), {
      [TABLE_PK]: chatPk(chatId),
      [TABLE_SK]: messageSk(createdAt, messageId),
      messageId,
      chatId,
      senderId: userId,
      body: 'hi',
      createdAt,
    });
    const page = await listMessages(chatId, { limit: 10 });
    expect(page.messages[0]?.senderDisplayName).toBe('Player');
  });

  it('rejects private chats with fewer than two members', async () => {
    const userId = randomUUID();
    seedProfile(userId, 'adult');
    await expect(
      createPrivateChat({ userId, body: { memberIds: [] } }),
    ).rejects.toThrow('invalid_body');
  });

  it('lists messages with sender photo keys and default page size', async () => {
    const userId = randomUUID();
    seedProfile(userId, 'adult', { photoKey: 'uploads/x.png' });
    const chatId = randomUUID();
    const createdAt = new Date().toISOString();
    const messageId = randomUUID();
    store.set(itemKey(chatPk(chatId), chatMetaSk()), {
      [TABLE_PK]: chatPk(chatId),
      [TABLE_SK]: chatMetaSk(),
      chatId,
      kind: 'private',
      name: 'Direct',
      createdAt,
    });
    store.set(itemKey(chatPk(chatId), messageSk(createdAt, messageId)), {
      [TABLE_PK]: chatPk(chatId),
      [TABLE_SK]: messageSk(createdAt, messageId),
      messageId,
      chatId,
      senderId: userId,
      body: 'hi',
      createdAt,
    });
    const page = await listMessages(chatId, {});
    expect(page.messages[0]?.senderPhotoKey).toBe('uploads/x.png');
  });

  it('requireChat throws when metadata is missing', async () => {
    await expect(requireChat(randomUUID())).rejects.toThrow('chat_not_found');
  });

  it('requireTeamMembership and toParticipant enforce roster and profiles', async () => {
    const userId = randomUUID();
    const otherId = randomUUID();
    seedProfile(userId, 'adult');
    const teamId = randomUUID();
    store.set(itemKey(teamPk(teamId), teamMetaSk()), {
      [TABLE_PK]: teamPk(teamId),
      [TABLE_SK]: teamMetaSk(),
      teamId,
      name: 'Hawks',
      timeZone: 'UTC',
      defaultChatId: randomUUID(),
      createdBy: userId,
      createdAt: new Date().toISOString(),
    });
    await expect(
      createTeamChannel({ userId, body: { teamId, name: 'General' } }),
    ).rejects.toThrow('not_a_member');

    await expect(
      createPrivateChat({ userId, body: { memberIds: [otherId] } }),
    ).rejects.toThrow('profile_not_found');
  });

  it('createTeamChannel rejects missing teams and bad roster rows', async () => {
    const userId = randomUUID();
    seedProfile(userId, 'adult');
    await expect(
      createTeamChannel({ userId, body: { teamId: randomUUID(), name: 'General' } }),
    ).rejects.toThrow('team_not_found');

    const teamId = randomUUID();
    store.set(itemKey(teamPk(teamId), teamMetaSk()), {
      [TABLE_PK]: teamPk(teamId),
      [TABLE_SK]: teamMetaSk(),
      teamId,
      name: 'Hawks',
      timeZone: 'UTC',
      defaultChatId: randomUUID(),
      createdBy: userId,
      createdAt: new Date().toISOString(),
    });
    store.set(itemKey(teamPk(teamId), teamMemberSk(userId)), {
      [TABLE_PK]: teamPk(teamId),
      [TABLE_SK]: teamMemberSk(userId),
      userId: 0,
      role: 'team_admin',
      joinedAt: new Date().toISOString(),
    });
    await expect(
      createTeamChannel({ userId, body: { teamId, name: 'General' } }),
    ).rejects.toThrow('not_a_member');
  });

  it('searchAdultByEmail hides minors and missing profiles', async () => {
    findProfileByEmail.mockResolvedValueOnce(undefined);
    await expect(searchAdultByEmail('a@example.com')).rejects.toThrow('user_not_found');
    findProfileByEmail.mockResolvedValueOnce({
      userId: 'm1',
      email: 'minor@example.com',
      displayName: 'Minor',
      accountKind: 'minor',
      createdAt: new Date().toISOString(),
    });
    await expect(searchAdultByEmail('minor@example.com')).rejects.toThrow('user_not_found');
  });
});
