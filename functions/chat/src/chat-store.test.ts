/**
 * Chat store coverage for sorting, attachments, and minor channel rules.
 */

import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryTable } from '../../lib/dynamo/memory-table.js';
import type { AccountKind } from '@gameplan/types';
import type { UserProfileItem } from '../../lib/auth/identity-provider.js';
import { DEFAULT_ROLE_PERMISSIONS } from '@gameplan/types';
import {
  chatAttachmentSk,
  TABLE_PK,
  TABLE_SK,
  chatMemberSk,
  chatMetaSk,
  chatPk,
  rolePermissionsSk,
  teamMemberSk,
  teamMetaSk,
  teamPk,
  messageSk,
  profileSk,
  userChatSk,
  userPk,
} from '../../lib/dynamo/keys.js';

const { profiles, findProfileByEmail, fanout } = vi.hoisted(() => {
  const profiles = new Map<
    string,
    {
      userId: string;
      displayName: string;
      email: string;
      accountKind: AccountKind;
      photoKey?: string;
    }
  >();
  const findProfileByEmail = vi.fn(
    async (..._args: unknown[]): Promise<UserProfileItem | undefined> => undefined,
  );
  const fanout = vi.fn(async (..._args: unknown[]): Promise<void> => undefined);
  return { profiles, findProfileByEmail, fanout };
});
const { store, itemKey } = memoryTable;

vi.mock('../../lib/auth/profile.js', async () => {
  const keys = await import('../../lib/dynamo/keys.js');
  return {
    getProfile: async (userId: string) => {
      const row = profiles.get(userId);
      if (row === undefined) return undefined;
      return {
        PK: keys.userPk(userId),
        SK: keys.profileSk(),
        userId: row.userId,
        email: row.email,
        displayName: row.displayName,
        accountKind: row.accountKind,
        createdAt: new Date().toISOString(),
        ...(row.photoKey !== undefined ? { photoKey: row.photoKey } : {}),
      };
    },
    findProfileByEmail: (...args: unknown[]) => findProfileByEmail(...args),
    toUserProfile: (item: {
      userId: string;
      email: string;
      displayName: string;
      accountKind: AccountKind;
    }) => item,
  };
});

vi.mock('../../lib/dynamo/access.js', async () => (await import('../../lib/dynamo/memory-table.js')).memoryAccess);

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
  loadChatParticipants,
  sendMessage,
} = await import('./chat-store.js');
const { memberChatName, refreshChatMemberNames, renameChatMember } = await import('../../lib/chat-member-names.js');

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
    const objectKey = `uploads/${userId}/file.png`;
    const message = await sendMessage({
      chatId,
      userId,
      body: { body: 'see file', attachmentKeys: [objectKey] },
    });
    expect(message.attachmentKeys).toEqual([objectKey]);
    expect(store.get(itemKey(chatPk(chatId), chatAttachmentSk(objectKey)))).toMatchObject({
      messageId: message.messageId,
      objectKey,
    });
    expect(fanout).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentKeys: [objectKey],
        senderPhotoKey: 'uploads/u/photo',
      }),
    );
  });

  it('sendMessage allows image-only bodies and rejects foreign attachment keys', async () => {
    const userId = randomUUID();
    const chatId = randomUUID();
    seedProfile(userId, 'adult');
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
    const objectKey = `uploads/${userId}/only.png`;
    const message = await sendMessage({
      chatId,
      userId,
      body: { body: '   ', attachmentKeys: [objectKey] },
    });
    expect(message.body).toBe('');
    expect(message.attachmentKeys).toEqual([objectKey]);

    await expect(
      sendMessage({
        chatId,
        userId,
        body: { body: '', attachmentKeys: ['uploads/other/file.png'] },
      }),
    ).rejects.toThrow('invalid_attachment_key');
    await expect(
      sendMessage({
        chatId,
        userId,
        body: { body: '   ' },
      }),
    ).rejects.toThrow('invalid_body');
  });

  it('renames only in private chats that already store member names', async () => {
    const userId = randomUUID();
    const chat = (chatId: string, kind: string, meta: Record<string, unknown> | undefined): void => {
      store.set(itemKey(userPk(userId), userChatSk(chatId)), {
        [TABLE_PK]: userPk(userId),
        [TABLE_SK]: userChatSk(chatId),
        chatId,
        kind,
      });
      if (meta !== undefined) {
        store.set(itemKey(chatPk(chatId), chatMetaSk()), {
          [TABLE_PK]: chatPk(chatId),
          [TABLE_SK]: chatMetaSk(),
          chatId,
          kind,
          ...meta,
        });
      }
    };
    chat('team', 'default', { memberNames: { [userId]: 'Old' } });
    chat('older', 'private', {});
    chat('gone', 'private', undefined);
    chat('named', 'private', { memberNames: { [userId]: 'Old', other: 'Sam' } });
    store.set(itemKey(userPk(userId), userChatSk('broken')), {
      [TABLE_PK]: userPk(userId),
      [TABLE_SK]: userChatSk('broken'),
      kind: 'private',
    });

    await renameChatMember(userId, 'New');
    expect(store.get(itemKey(chatPk('named'), chatMetaSk()))?.memberNames).toEqual({ [userId]: 'New', other: 'Sam' });
    expect(store.get(itemKey(chatPk('team'), chatMetaSk()))?.memberNames).toEqual({ [userId]: 'Old' });
    expect(store.get(itemKey(chatPk('older'), chatMetaSk()))?.memberNames).toBeUndefined();
    expect(await refreshChatMemberNames('gone')).toBeUndefined();
    expect(memberChatName({ [userId]: 'Me' }, userId)).toBeUndefined();
  });

  it('createTeamChannel writes a channel without applying chat membership rules', async () => {
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
    const created = await createTeamChannel({
      userId: adminId,
      body: { teamId, name: 'Parents' },
    });
    expect(created.name).toBe('Parents');
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

  it('names an unnamed private chat from the names stored on it', async () => {
    const seedNamed = (displayName: string): string => {
      const id = randomUUID();
      profiles.set(id, { userId: id, email: `${id}@example.com`, displayName, accountKind: 'adult' });
      store.set(itemKey(userPk(id), profileSk()), { [TABLE_PK]: userPk(id), [TABLE_SK]: profileSk(), displayName });
      return id;
    };
    const userId = seedNamed('User');
    const others = ['Sam', 'Alex', 'Jo', 'Pat'].map(seedNamed);
    const pair = await createPrivateChat({ userId, body: { memberIds: [others[0]!] } });
    expect(pair.name).toBe('Sam');
    expect(store.get(itemKey(chatPk(pair.chatId), chatMetaSk()))?.memberNames).toEqual({
      [userId]: 'User',
      [others[0]!]: 'Sam',
    });
    await createPrivateChat({ userId, body: { memberIds: others } });
    await createPrivateChat({ userId, body: { memberIds: [others[0]!], name: 'Ride home' } });
    expect((await listUserChats(userId)).map((row) => row.name)).toEqual([
      'Alex, Jo, Pat +1',
      'Ride home',
      'Sam',
    ]);
    expect((await listUserChats(others[0]!)).map((row) => row.name)).toContain('User');

    await renameChatMember(others[0]!, 'Sammy');
    expect((await listUserChats(userId)).map((row) => row.name)).toContain('Sammy');
  });

  it('stores member names on an older unnamed private chat when first listed', async () => {
    const userId = randomUUID();
    const otherId = randomUUID();
    const chatId = randomUUID();
    store.set(itemKey(userPk(otherId), profileSk()), { [TABLE_PK]: userPk(otherId), [TABLE_SK]: profileSk(), displayName: 'Sam' });
    store.set(itemKey(chatPk(chatId), chatMetaSk()), {
      [TABLE_PK]: chatPk(chatId),
      [TABLE_SK]: chatMetaSk(),
      chatId,
      kind: 'private',
      name: 'Private chat',
      createdAt: new Date().toISOString(),
    });
    for (const id of [userId, otherId]) {
      store.set(itemKey(chatPk(chatId), chatMemberSk(id)), { [TABLE_PK]: chatPk(chatId), [TABLE_SK]: chatMemberSk(id), userId: id });
    }
    store.set(itemKey(userPk(userId), userChatSk(chatId)), { [TABLE_PK]: userPk(userId), [TABLE_SK]: userChatSk(chatId), chatId });
    expect((await listUserChats(userId))[0]?.name).toBe('Sam');
    expect(store.get(itemKey(chatPk(chatId), chatMetaSk()))?.memberNames).toEqual({ [userId]: 'Player', [otherId]: 'Sam' });
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

  it('requireTeamMembership and loadChatParticipants enforce roster and profiles', async () => {
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

    await expect(loadChatParticipants([otherId])).rejects.toThrow('profile_not_found');
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

});
