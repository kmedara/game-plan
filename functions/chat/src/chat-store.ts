/**
 * DynamoDB item shapes and writes for the chat area.
 */

import { randomUUID } from 'node:crypto';
import { findProfileByEmail, getProfile, toUserProfile } from '../../lib/auth/index.js';
import type {
  CreatePrivateChatBody,
  CreateTeamChannelBody,
  SendMessageBody,
} from '@gameplan/schemas';
import type {
  ChatKind,
  ChatMessage,
  ChatSummary,
  MessageHistoryQuery,
  MessagePage,
  UserProfile,
} from '@gameplan/types';
import {
  MESSAGE_SK_PREFIX,
  TABLE_PK,
  TABLE_SK,
  TEAM_MEMBER_SK_PREFIX,
  USER_CHAT_SK_PREFIX,
  USER_TEAM_SK_PREFIX,
  chatMemberSk,
  chatMetaSk,
  chatPk,
  getItem,
  messageSk,
  putItem,
  queryBySkPrefix,
  queryPage,
  teamMemberSk,
  teamMetaSk,
  teamPk,
  transactWrite,
  userChatSk,
  userPk,
} from '../../lib/dynamo/index.js';
import { enqueueFanout } from '../../lib/fanout-enqueue.js';
import {
  isMinorChatMembershipAllowed,
  type ChatParticipant,
} from '../../lib/minor-chat.js';
import { TABLE_NAME } from '../../lib/names.js';
import { matchesUserSearchPolicy, V1_USER_SEARCH_POLICY } from '../../lib/search-policy.js';

/** Default page size for reverse message history. */
const DEFAULT_MESSAGE_PAGE = 50;

/** DynamoDB TransactWriteItems hard limit. */
const TRANSACT_MAX_ITEMS = 100;

/** Team metadata subset needed for channel creation. */
type TeamMetaItem = {
  teamId: string;
  name: string;
};

/** Roster membership under `TEAM#id` / `MEMBER#userId`. */
type TeamMemberItem = {
  userId: string;
  role: string;
};

/** User-side team membership under `USER#id` / `TEAM#teamId`. */
type UserTeamItem = {
  teamId: string;
  role: string;
};

/** Chat metadata under `CHAT#id` / `META`. */
export type ChatMetaItem = {
  PK: string;
  SK: string;
  chatId: string;
  kind: ChatKind;
  name: string;
  teamId?: string;
  createdBy: string;
  createdAt: string;
};

/** Member under `CHAT#id` / `MEMBER#userId`. */
export type ChatMemberItem = {
  PK: string;
  SK: string;
  userId: string;
  joinedAt: string;
};

/** User-side chat membership under `USER#id` / `CHAT#chatId`. */
export type UserChatItem = {
  PK: string;
  SK: string;
  chatId: string;
  kind: ChatKind;
  teamId?: string;
  name?: string;
};

/** Message under `CHAT#id` / `MSG#createdAt#messageId`. */
export type MessageItem = {
  PK: string;
  SK: string;
  messageId: string;
  chatId: string;
  senderId: string;
  body: string;
  attachmentKeys?: string[];
  createdAt: string;
};

/**
 * Maps a chat meta item to the wire response.
 *
 * @param item - The stored chat row.
 * @returns The public chat payload.
 */
export const toChatResponse = (item: ChatMetaItem): ChatSummary => ({
  chatId: item.chatId,
  kind: item.kind,
  name: item.name,
  ...(item.teamId !== undefined ? { teamId: item.teamId } : {}),
  createdBy: item.createdBy,
  createdAt: item.createdAt,
});

/**
 * Maps a message item to the wire response without sender identity.
 *
 * Callers attach the current profile through {@link withSenderIdentity}.
 *
 * @param item - The stored message row.
 * @returns The public message payload, minus name and photo.
 */
const toStoredMessage = (
  item: MessageItem,
): Omit<ChatMessage, 'senderDisplayName' | 'senderPhotoKey'> => ({
  messageId: item.messageId,
  chatId: item.chatId,
  senderId: item.senderId,
  body: item.body,
  ...(item.attachmentKeys !== undefined ? { attachmentKeys: item.attachmentKeys } : {}),
  createdAt: item.createdAt,
});

/** Name shown when the sender's profile row is gone. */
const FALLBACK_SENDER_NAME = 'Player';

/** Current public identity of a message author. */
type SenderIdentity = {
  senderDisplayName: string;
  senderPhotoKey?: string;
};

/**
 * Loads the name and photo key shown beside a sender's messages.
 *
 * A missing profile still produces a name so the thread never shows a raw id.
 *
 * @param userId - The sender's user id.
 * @returns Display name and photo key when the profile has one.
 */
const senderIdentity = async (userId: string): Promise<SenderIdentity> => {
  const profile = await getProfile(userId);
  if (profile === undefined) return { senderDisplayName: FALLBACK_SENDER_NAME };
  return {
    senderDisplayName: profile.displayName,
    ...(profile.photoKey !== undefined ? { senderPhotoKey: profile.photoKey } : {}),
  };
};

/**
 * Attaches each sender's current name and photo to stored messages.
 *
 * Profiles are loaded once per distinct sender. Name and photo stay off the
 * message row so a later profile edit shows up on older messages.
 *
 * @param items - Stored message rows.
 * @returns Wire messages with sender identity.
 */
const withSenderIdentity = async (items: readonly MessageItem[]): Promise<ChatMessage[]> => {
  const identities = new Map<string, SenderIdentity>();
  const senderIds = [...new Set(items.map((item) => item.senderId))];
  await Promise.all(
    senderIds.map(async (senderId) => {
      identities.set(senderId, await senderIdentity(senderId));
    }),
  );
  return items.map((item) => ({
    ...toStoredMessage(item),
    ...identities.get(item.senderId)!,
  }));
};

/**
 * Loads chat metadata, or throws when the chat does not exist.
 *
 * @param chatId - The chat id.
 * @returns The chat metadata row.
 */
export const requireChat = async (chatId: string): Promise<ChatMetaItem> => {
  const chat = await getItem<ChatMetaItem>(chatPk(chatId), chatMetaSk());
  if (chat === undefined) throw new Error('chat_not_found');
  return chat;
};

/**
 * Requires the caller to already be a chat member.
 *
 * @param chatId - The chat id.
 * @param userId - The caller's user id.
 */
export const requireChatMembership = async (chatId: string, userId: string): Promise<void> => {
  const member = await getItem<ChatMemberItem>(chatPk(chatId), chatMemberSk(userId));
  if (member === undefined) throw new Error('not_a_chat_member');
};

/**
 * Requires the caller to already be on the team roster.
 *
 * @param teamId - The team id.
 * @param userId - The caller's user id.
 */
export const requireTeamMembership = async (teamId: string, userId: string): Promise<void> => {
  const member = await getItem<TeamMemberItem>(teamPk(teamId), teamMemberSk(userId));
  if (member === undefined) throw new Error('not_a_member');
};

/**
 * Builds a {@link ChatParticipant} from the profile and team memberships.
 *
 * @param userId - The user id.
 * @returns The participant fields the minor rule needs.
 */
const toParticipant = async (userId: string): Promise<ChatParticipant> => {
  const profile = await getProfile(userId);
  if (profile === undefined) throw new Error('profile_not_found');
  const teams = await queryBySkPrefix<UserTeamItem>(userPk(userId), USER_TEAM_SK_PREFIX);
  return {
    userId,
    accountKind: profile.accountKind,
    teamIds: teams
      .map((row) => row.teamId)
      .filter((teamId): teamId is string => typeof teamId === 'string'),
  };
};

/**
 * Builds Put items for chat and user-side membership of one person.
 *
 * @param chat - Chat fields needed on the user-side row.
 * @param userId - The member's user id.
 * @param joinedAt - ISO timestamp.
 * @returns Two TransactWrite Put items.
 */
const membershipPuts = (
  chat: Pick<ChatMetaItem, 'chatId' | 'kind' | 'teamId' | 'name'>,
  userId: string,
  joinedAt: string,
) => {
  const table = TABLE_NAME;
  return [
    {
      Put: {
        TableName: table,
        Item: {
          [TABLE_PK]: chatPk(chat.chatId),
          [TABLE_SK]: chatMemberSk(userId),
          userId,
          joinedAt,
        } satisfies ChatMemberItem,
      },
    },
    {
      Put: {
        TableName: table,
        Item: {
          [TABLE_PK]: userPk(userId),
          [TABLE_SK]: userChatSk(chat.chatId),
          chatId: chat.chatId,
          kind: chat.kind,
          ...(chat.teamId !== undefined ? { teamId: chat.teamId } : {}),
          name: chat.name,
        } satisfies UserChatItem,
      },
    },
  ];
};

/**
 * Writes membership rows in TransactWrite batches that stay under the item cap.
 *
 * @param chat - Chat fields for the user-side rows.
 * @param userIds - Members to add.
 * @param joinedAt - ISO timestamp.
 */
const writeMemberships = async (
  chat: Pick<ChatMetaItem, 'chatId' | 'kind' | 'teamId' | 'name'>,
  userIds: readonly string[],
  joinedAt: string,
): Promise<void> => {
  // Each member costs two Put items; stay under the TransactWriteItems limit.
  const perBatch = Math.floor(TRANSACT_MAX_ITEMS / 2);
  for (let i = 0; i < userIds.length; i += perBatch) {
    const slice = userIds.slice(i, i + perBatch);
    const items = slice.flatMap((userId) => membershipPuts(chat, userId, joinedAt));
    await transactWrite(items);
  }
};

/**
 * Lists chats the caller belongs to (default, channel, and private).
 *
 * @param userId - The caller's user id.
 * @returns Chat summaries ordered by kind then name.
 */
export const listUserChats = async (userId: string): Promise<ChatSummary[]> => {
  const memberships = await queryBySkPrefix<UserChatItem>(userPk(userId), USER_CHAT_SK_PREFIX);
  const chats: ChatSummary[] = [];
  for (const membership of memberships) {
    if (typeof membership.chatId !== 'string') continue;
    const meta = await getItem<ChatMetaItem>(chatPk(membership.chatId), chatMetaSk());
    if (meta === undefined) continue;
    chats.push(toChatResponse(meta));
  }

  const kindOrder: Record<ChatKind, number> = { default: 0, channel: 1, private: 2 };
  chats.sort((a, b) => {
    const byKind = kindOrder[a.kind] - kindOrder[b.kind];
    if (byKind !== 0) return byKind;
    return a.name.localeCompare(b.name);
  });
  return chats;
};

/**
 * Creates a team-visible channel and adds every current roster member.
 *
 * @param input - Caller, team, and channel name.
 * @returns The created chat.
 */
export const createTeamChannel = async (input: {
  userId: string;
  body: CreateTeamChannelBody;
}): Promise<ChatSummary> => {
  const team = await getItem<TeamMetaItem>(teamPk(input.body.teamId), teamMetaSk());
  if (team === undefined) throw new Error('team_not_found');
  await requireTeamMembership(input.body.teamId, input.userId);

  const roster = await queryBySkPrefix<TeamMemberItem>(
    teamPk(input.body.teamId),
    TEAM_MEMBER_SK_PREFIX,
  );
  const memberIds = roster
    .map((row) => row.userId)
    .filter((id): id is string => typeof id === 'string');
  if (!memberIds.includes(input.userId)) throw new Error('not_a_member');

  const participants = await Promise.all(memberIds.map((id) => toParticipant(id)));
  if (!isMinorChatMembershipAllowed(participants)) {
    throw new Error('minor_chat_rule_violated');
  }

  const chatId = randomUUID();
  const createdAt = new Date().toISOString();
  const name = input.body.name.trim();
  const meta: ChatMetaItem = {
    [TABLE_PK]: chatPk(chatId),
    [TABLE_SK]: chatMetaSk(),
    chatId,
    kind: 'channel',
    name,
    teamId: input.body.teamId,
    createdBy: input.userId,
    createdAt,
  };

  await putItem(meta);
  await writeMemberships(
    { chatId, kind: 'channel', teamId: input.body.teamId, name },
    memberIds,
    createdAt,
  );
  return toChatResponse(meta);
};

/**
 * Creates a private chat with the caller and the listed members.
 *
 * @param input - Caller and other member ids.
 * @returns The created chat.
 */
export const createPrivateChat = async (input: {
  userId: string;
  body: CreatePrivateChatBody;
}): Promise<ChatSummary> => {
  const memberIds = [...new Set([input.userId, ...input.body.memberIds])];
  if (memberIds.length < 2) throw new Error('invalid_body');

  const participants = await Promise.all(memberIds.map((id) => toParticipant(id)));
  if (!isMinorChatMembershipAllowed(participants)) {
    throw new Error('minor_chat_rule_violated');
  }

  const chatId = randomUUID();
  const createdAt = new Date().toISOString();
  const name = 'Private chat';
  const meta: ChatMetaItem = {
    [TABLE_PK]: chatPk(chatId),
    [TABLE_SK]: chatMetaSk(),
    chatId,
    kind: 'private',
    name,
    createdBy: input.userId,
    createdAt,
  };

  await putItem(meta);
  await writeMemberships({ chatId, kind: 'private', name }, memberIds, createdAt);
  return toChatResponse(meta);
};

/**
 * Exact-email user search under the v1 adults-only policy.
 *
 * Minors and missing emails look the same to the caller (`user_not_found`).
 *
 * @param email - The email from the query string.
 * @returns The public profile when the policy allows it.
 */
export const searchAdultByEmail = async (email: string): Promise<UserProfile> => {
  const normalized = email.trim().toLowerCase();
  const profile = await findProfileByEmail(normalized);
  if (profile === undefined) throw new Error('user_not_found');
  if (!matchesUserSearchPolicy(profile.accountKind, V1_USER_SEARCH_POLICY)) {
    throw new Error('user_not_found');
  }
  return toUserProfile(profile);
};

/**
 * Lists messages newest-first with a page cursor.
 *
 * @param chatId - The chat id.
 * @param options - Page size and optional cursor.
 * @returns Messages and the next cursor when more remain.
 */
export const listMessages = async (
  chatId: string,
  options: MessageHistoryQuery = {},
): Promise<MessagePage> => {
  await requireChat(chatId);
  const limit = options.limit ?? DEFAULT_MESSAGE_PAGE;
  const page = await queryPage<MessageItem>(
    {
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      ExpressionAttributeNames: { '#pk': TABLE_PK, '#sk': TABLE_SK },
      ExpressionAttributeValues: {
        ':pk': chatPk(chatId),
        ':skPrefix': MESSAGE_SK_PREFIX,
      },
      ScanIndexForward: false,
    },
    { limit, cursor: options.cursor },
  );

  return {
    messages: await withSenderIdentity(page.items),
    ...(page.cursor !== undefined ? { cursor: page.cursor } : {}),
  };
};

/**
 * Persists a message and enqueues fan-out delivery.
 *
 * @param input - Chat, sender, and message body.
 * @returns The stored message.
 */
export const sendMessage = async (input: {
  chatId: string;
  userId: string;
  body: SendMessageBody;
}): Promise<ChatMessage> => {
  await requireChat(input.chatId);
  await requireChatMembership(input.chatId, input.userId);

  const createdAt = new Date().toISOString();
  const messageId = randomUUID();
  const item: MessageItem = {
    [TABLE_PK]: chatPk(input.chatId),
    [TABLE_SK]: messageSk(createdAt, messageId),
    messageId,
    chatId: input.chatId,
    senderId: input.userId,
    body: input.body.body,
    ...(input.body.attachmentKeys !== undefined
      ? { attachmentKeys: input.body.attachmentKeys }
      : {}),
    createdAt,
  };

  await putItem(item);
  const identity = await senderIdentity(input.userId);
  await enqueueFanout({
    type: 'chat_message',
    chatId: input.chatId,
    messageId,
    senderId: input.userId,
    senderDisplayName: identity.senderDisplayName,
    ...(identity.senderPhotoKey !== undefined
      ? { senderPhotoKey: identity.senderPhotoKey }
      : {}),
    body: input.body.body,
    createdAt,
    ...(input.body.attachmentKeys !== undefined
      ? { attachmentKeys: input.body.attachmentKeys }
      : {}),
  });
  return { ...toStoredMessage(item), ...identity };
};

