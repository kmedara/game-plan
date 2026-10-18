/**
 * The two rows that put a person in a chat, shared by every area that adds members.
 *
 * `CHAT#id` / `MEMBER#userId` lets the chat list its members. `USER#id` /
 * `CHAT#chatId` lets the person list their chats. Both are always written and
 * removed together.
 */

import type { ChatKind } from '@gameplan/types';
import {
  CHAT_MEMBER_SK_PREFIX,
  TABLE_PK,
  TABLE_SK,
  chatMemberSk,
  chatPk,
  deleteItem,
  putItem,
  queryBySkPrefix,
  userChatSk,
  userPk,
} from './dynamo/index.js';

/** Chat fields copied onto the person's own chat row. */
export type ChatMembershipChat = {
  chatId: string;
  kind: ChatKind;
  teamId?: string;
  name?: string;
};

/**
 * Builds both membership rows for one person.
 *
 * @param chat - The chat being joined.
 * @param userId - The member.
 * @param joinedAt - ISO timestamp.
 * @returns The chat-side row, then the user-side row.
 */
export const chatMembershipItems = (
  chat: ChatMembershipChat,
  userId: string,
  joinedAt: string,
): [Record<string, unknown>, Record<string, unknown>] => [
  {
    [TABLE_PK]: chatPk(chat.chatId),
    [TABLE_SK]: chatMemberSk(userId),
    userId,
    joinedAt,
  },
  {
    [TABLE_PK]: userPk(userId),
    [TABLE_SK]: userChatSk(chat.chatId),
    chatId: chat.chatId,
    kind: chat.kind,
    ...(chat.teamId !== undefined ? { teamId: chat.teamId } : {}),
    ...(chat.name !== undefined ? { name: chat.name } : {}),
  },
];

/**
 * Current members of a chat.
 *
 * @param chatId - The chat.
 * @returns Member user ids.
 */
export const listChatMemberIds = async (chatId: string): Promise<string[]> => {
  const rows = await queryBySkPrefix<{ userId?: unknown }>(chatPk(chatId), CHAT_MEMBER_SK_PREFIX);
  return rows.flatMap((row) => (typeof row.userId === 'string' ? [row.userId] : []));
};

/**
 * Adds one person to a chat.
 *
 * @param chat - The chat being joined.
 * @param userId - The new member.
 * @param joinedAt - ISO timestamp.
 */
export const addChatMember = async (
  chat: ChatMembershipChat,
  userId: string,
  joinedAt: string,
): Promise<void> => {
  for (const item of chatMembershipItems(chat, userId, joinedAt)) await putItem(item);
};

/**
 * Removes one person from a chat.
 *
 * @param chatId - The chat.
 * @param userId - The member leaving.
 */
export const removeChatMember = async (chatId: string, userId: string): Promise<void> => {
  await deleteItem(chatPk(chatId), chatMemberSk(userId));
  await deleteItem(userPk(userId), userChatSk(chatId));
};

/**
 * Makes a chat's members match the desired set.
 *
 * @param chat - The chat, with the fields its new user-side rows carry.
 * @param desiredIds - Everyone who should be in it.
 * @param joinedAt - ISO timestamp for anyone added.
 * @returns Whether anyone joined or left.
 */
export const syncChatMembers = async (
  chat: ChatMembershipChat,
  desiredIds: readonly string[],
  joinedAt: string,
): Promise<boolean> => {
  const current = new Set(await listChatMemberIds(chat.chatId));
  const desired = new Set(desiredIds);
  let changed = false;
  for (const userId of current) {
    if (desired.has(userId)) continue;
    await removeChatMember(chat.chatId, userId);
    changed = true;
  }
  for (const userId of desired) {
    if (current.has(userId)) continue;
    await addChatMember(chat, userId, joinedAt);
    changed = true;
  }
  return changed;
};
