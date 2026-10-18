/**
 * Member names stored on a private chat's row, so the list can name it.
 *
 * Chat creation and carpool sync write the names when members change. A
 * display name change rewrites them in every private chat the user is in.
 */

import {
  CHAT_MEMBER_SK_PREFIX,
  USER_CHAT_SK_PREFIX,
  chatMetaSk,
  chatPk,
  getItem,
  profileSk,
  putItem,
  queryBySkPrefix,
  userPk,
} from './dynamo/index.js';

/** Display names by user id, as stored on the chat row. */
export type ChatMemberNames = Record<string, string>;

/** Name used when a member's profile row is gone. */
const FALLBACK_MEMBER_NAME = 'Player';

/** Member names listed before the rest collapse into a count. */
const NAMED_MEMBER_LIMIT = 3;

/**
 * Loads the current display name of each user.
 *
 * @param userIds - Chat members.
 * @returns Display names by user id.
 */
export const loadMemberNames = async (userIds: readonly string[]): Promise<ChatMemberNames> => {
  const entries = await Promise.all(
    userIds.map(async (userId) => {
      const profile = await getItem<{ displayName?: string }>(userPk(userId), profileSk());
      return [userId, profile?.displayName ?? FALLBACK_MEMBER_NAME] as const;
    }),
  );
  return Object.fromEntries(entries);
};

/**
 * Rewrites the stored names from the chat's current members.
 *
 * @param chatId - A private chat.
 * @returns The stored names, or `undefined` when the chat is gone.
 */
export const refreshChatMemberNames = async (chatId: string): Promise<ChatMemberNames | undefined> => {
  const meta = await getItem<Record<string, unknown>>(chatPk(chatId), chatMetaSk());
  if (meta === undefined) return undefined;
  const rows = await queryBySkPrefix<{ userId?: string }>(chatPk(chatId), CHAT_MEMBER_SK_PREFIX);
  const memberNames = await loadMemberNames(
    rows.flatMap((row) => (typeof row.userId === 'string' ? [row.userId] : [])),
  );
  await putItem({ ...meta, memberNames });
  return memberNames;
};

/**
 * Puts a user's new display name on every private chat they are in.
 *
 * @param userId - The renamed user.
 * @param displayName - Their new display name.
 */
export const renameChatMember = async (userId: string, displayName: string): Promise<void> => {
  const chats = await queryBySkPrefix<{ chatId?: string; kind?: string }>(userPk(userId), USER_CHAT_SK_PREFIX);
  for (const chat of chats) {
    if (chat.kind !== 'private' || typeof chat.chatId !== 'string') continue;
    const meta = await getItem<{ memberNames?: ChatMemberNames }>(chatPk(chat.chatId), chatMetaSk());
    if (meta?.memberNames === undefined) continue;
    await putItem({ ...meta, memberNames: { ...meta.memberNames, [userId]: displayName } });
  }
};

/**
 * Names a chat after everyone in it except the viewer.
 *
 * @param memberNames - Stored names by user id.
 * @param viewerId - The user the list is for.
 * @returns Up to three sorted names and a count of the rest, or `undefined`
 *   when nobody else is in the chat.
 */
export const memberChatName = (memberNames: ChatMemberNames, viewerId: string): string | undefined => {
  const names = Object.entries(memberNames)
    .filter(([userId]) => userId !== viewerId)
    .map(([, name]) => name)
    .sort((left, right) => left.localeCompare(right));
  if (names.length === 0) return undefined;
  const shown = names.slice(0, NAMED_MEMBER_LIMIT).join(', ');
  const hidden = names.length - NAMED_MEMBER_LIMIT;
  return hidden > 0 ? `${shown} +${hidden}` : shown;
};
