/**
 * DynamoDB item shapes and writes for the chat area.
 */

import { randomUUID } from 'node:crypto';
import { getProfile } from '../../lib/auth/index.js';
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
  Poll,
} from '@gameplan/types';
import {
  MESSAGE_SK_PREFIX,
  TABLE_PK,
  TABLE_SK,
  USER_CHAT_SK_PREFIX,
  USER_TEAM_SK_PREFIX,
  chatMemberSk,
  chatMetaSk,
  chatPk,
  getItem,
  messageSk,
  pollSk,
  putItem,
  queryBySkPrefix,
  queryPage,
  teamMemberSk,
  teamMetaSk,
  teamPk,
  transactWrite,
  userPk,
} from '../../lib/dynamo/index.js';
import {
  loadMemberNames,
  memberChatName,
  refreshChatMemberNames,
  type ChatMemberNames,
} from '../../lib/chat-member-names.js';
import { chatMembershipItems } from '../../lib/chat-membership.js';
import { enqueueFanout } from '../../lib/fanout-enqueue.js';
import { listGuardianIds } from '../../lib/guardians.js';
import { listTeamMemberIds } from '../../lib/team-roster.js';
import { isOwnedUploadKey } from '../../lib/upload-keys.js';
import type { ChatParticipant } from '@gameplan/types';
import { TABLE_NAME } from '../../lib/names.js';

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
  /** Private chats only: everyone in the chat, for naming it per viewer. */
  memberNames?: ChatMemberNames;
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
  poll?: Poll;
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
  ...(item.poll !== undefined ? { poll: item.poll } : {}),
});

/** Name shown when the sender's profile row is gone. */
const FALLBACK_SENDER_NAME = 'Player';

/** Stored name of a private chat created without one. */
const DEFAULT_PRIVATE_CHAT_NAME = 'Private chat';

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
 * Names an unnamed private chat after everyone in it except the viewer.
 *
 * The name is built per viewer from the names stored on the chat row. Chats
 * written before those names existed get them on first list. Named chats and
 * team chats keep their stored name.
 *
 * @param meta - The chat as stored.
 * @param viewerId - The user the list is for.
 * @returns The chat with the name that viewer sees.
 */
const withViewerName = async (meta: ChatMetaItem, viewerId: string): Promise<ChatSummary> => {
  const chat = toChatResponse(meta);
  if (chat.kind !== 'private' || chat.name !== DEFAULT_PRIVATE_CHAT_NAME) return chat;
  const memberNames = meta.memberNames ?? (await refreshChatMemberNames(chat.chatId)) ?? {};
  const name = memberChatName(memberNames, viewerId);
  return name === undefined ? chat : { ...chat, name };
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
  const guardianIds = profile.accountKind === 'minor' ? await listGuardianIds(userId) : undefined;
  return {
    userId,
    accountKind: profile.accountKind,
    teamIds: teams
      .map((row) => row.teamId)
      .filter((teamId): teamId is string => typeof teamId === 'string'),
    ...(guardianIds !== undefined && guardianIds.length > 0 ? { guardianIds } : {}),
  };
};

/**
 * Loads the profile and team ids the minor-chat rule needs.
 *
 * @param userIds - Members of the proposed chat.
 * @returns One participant per user id.
 */
export const loadChatParticipants = async (
  userIds: readonly string[],
): Promise<ChatParticipant[]> => Promise.all(userIds.map((userId) => toParticipant(userId)));

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
    const items = slice.flatMap((userId) =>
      chatMembershipItems(chat, userId, joinedAt).map((Item) => ({ Put: { TableName: TABLE_NAME, Item } })),
    );
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
    chats.push(await withViewerName(meta, userId));
  }

  const kindOrder: Record<ChatKind, number> = { default: 0, channel: 1, private: 2, fixture: 3 };
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
  extraMemberIds?: readonly string[];
}): Promise<ChatSummary> => {
  const team = await getItem<TeamMetaItem>(teamPk(input.body.teamId), teamMetaSk());
  if (team === undefined) throw new Error('team_not_found');
  await requireTeamMembership(input.body.teamId, input.userId);

  const memberIds = [
    ...new Set([...(await listTeamMemberIds(input.body.teamId)), ...(input.extraMemberIds ?? [])]),
  ];
  if (!memberIds.includes(input.userId)) throw new Error('not_a_member');

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

  const chatId = randomUUID();
  const createdAt = new Date().toISOString();
  const trimmedName = input.body.name?.trim();
  const name =
    trimmedName !== undefined && trimmedName.length > 0 ? trimmedName : DEFAULT_PRIVATE_CHAT_NAME;
  const meta: ChatMetaItem = {
    [TABLE_PK]: chatPk(chatId),
    [TABLE_SK]: chatMetaSk(),
    chatId,
    kind: 'private',
    name,
    createdBy: input.userId,
    createdAt,
    memberNames: await loadMemberNames(memberIds),
  };

  await putItem(meta);
  await writeMemberships({ chatId, kind: 'private', name }, memberIds, createdAt);
  return withViewerName(meta, input.userId);
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
 * A poll message carries the poll; its body is the question, so chat
 * previews and push text work unchanged.
 *
 * @param input - Chat, sender, message body, and an optional poll.
 * @returns The stored message.
 */
export const sendMessage = async (input: {
  chatId: string;
  userId: string;
  body: SendMessageBody;
  poll?: Poll;
}): Promise<ChatMessage> => {
  await requireChat(input.chatId);
  await requireChatMembership(input.chatId, input.userId);

  const bodyText = input.body.body.trim();
  const attachmentKeys = (input.body.attachmentKeys ?? []).filter((key) => key.length > 0);
  if (bodyText.length === 0 && attachmentKeys.length === 0) {
    throw new Error('invalid_body');
  }
  for (const key of attachmentKeys) {
    if (!isOwnedUploadKey(input.userId, key)) {
      throw new Error('invalid_attachment_key');
    }
  }

  const createdAt = new Date().toISOString();
  const messageId = randomUUID();
  const item: MessageItem = {
    [TABLE_PK]: chatPk(input.chatId),
    [TABLE_SK]: messageSk(createdAt, messageId),
    messageId,
    chatId: input.chatId,
    senderId: input.userId,
    body: bodyText,
    ...(attachmentKeys.length > 0 ? { attachmentKeys } : {}),
    createdAt,
    ...(input.poll !== undefined ? { poll: input.poll } : {}),
  };

  await putItem(item);
  if (input.poll !== undefined) {
    await putItem({
      [TABLE_PK]: chatPk(input.chatId),
      [TABLE_SK]: pollSk(messageId),
      chatId: input.chatId,
      messageId,
      poll: input.poll,
    });
  }
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
    body: bodyText,
    createdAt,
    ...(attachmentKeys.length > 0 ? { attachmentKeys } : {}),
    ...(input.poll !== undefined ? { poll: input.poll } : {}),
  });
  return {
    ...toStoredMessage(item),
    ...identity,
    ...(input.poll !== undefined ? { pollTally: { counts: {}, voters: 0, mine: [] } } : {}),
  };
};

