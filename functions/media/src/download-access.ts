/**
 * Decides whether a signed-in user may download a media object key.
 *
 * Own uploads are allowed from the key prefix. A profile photo needs the
 * subject user id and a shared team. A chat attachment needs the chat id,
 * membership, and the key on a message in that chat. A team logo needs
 * membership and the key stored on that team's theme.
 */

import { getProfile } from '../../lib/auth/index.js';
import type { PresignDownloadQuery } from '@gameplan/types';
import {
  MESSAGE_SK_PREFIX,
  USER_TEAM_SK_PREFIX,
  chatMemberSk,
  chatPk,
  getItem,
  queryBySkPrefix,
  teamMetaSk,
  teamPk,
  userPk,
  userTeamSk,
} from '../../lib/dynamo/index.js';

/** Chat, profile, or team fields from {@link PresignDownloadQuery}. */
export type DownloadContext = Pick<PresignDownloadQuery, 'chatId' | 'userId' | 'teamId'>;

/**
 * Returns whether the key is an upload stored under this user.
 *
 * @param userId - The caller.
 * @param objectKey - The media object key.
 * @returns `true` when the key is that user's upload.
 */
const isOwnedUploadKey = (userId: string, objectKey: string): boolean => {
  const prefix = `uploads/${userId}/`;
  return (
    objectKey.startsWith(prefix) &&
    objectKey.length > prefix.length &&
    !objectKey.includes('..') &&
    !objectKey.includes('\\')
  );
};

/**
 * Loads team ids from the user-side membership rows.
 *
 * @param userId - The user id.
 * @returns Team ids the user belongs to.
 */
const teamIdsOf = async (userId: string): Promise<Set<string>> => {
  const rows = await queryBySkPrefix<{ teamId?: unknown; SK?: unknown }>(
    userPk(userId),
    USER_TEAM_SK_PREFIX,
  );
  const teamIds = new Set<string>();
  for (const row of rows) {
    if (typeof row.teamId === 'string' && row.teamId.length > 0) {
      teamIds.add(row.teamId);
      continue;
    }
    if (typeof row.SK === 'string' && row.SK.startsWith(userTeamSk(''))) {
      const teamId = row.SK.slice(USER_TEAM_SK_PREFIX.length);
      if (teamId.length > 0) teamIds.add(teamId);
    }
  }
  return teamIds;
};

/**
 * Returns whether two users share a team.
 *
 * @param leftUserId - The caller.
 * @param rightUserId - The profile being viewed.
 * @returns `true` when the team lists intersect.
 */
const sharesTeam = async (leftUserId: string, rightUserId: string): Promise<boolean> => {
  const [left, right] = await Promise.all([teamIdsOf(leftUserId), teamIdsOf(rightUserId)]);
  for (const teamId of left) {
    if (right.has(teamId)) return true;
  }
  return false;
};

/**
 * Returns whether a chat message lists the object key as an attachment.
 *
 * @param chatId - The chat id.
 * @param objectKey - The media object key.
 * @returns `true` when a message in that chat stores the key.
 */
const chatHasAttachment = async (chatId: string, objectKey: string): Promise<boolean> => {
  const messages = await queryBySkPrefix<{ attachmentKeys?: unknown }>(
    chatPk(chatId),
    MESSAGE_SK_PREFIX,
  );
  return messages.some(
    (message) =>
      Array.isArray(message.attachmentKeys) && message.attachmentKeys.includes(objectKey),
  );
};

/**
 * Ensures the caller may download the object key.
 *
 * @param callerId - The authenticated user id.
 * @param objectKey - The media object key.
 * @param context - Optional chat or profile the client is viewing.
 * @throws When the caller is not allowed to download the key.
 */
export const assertCanDownload = async (
  callerId: string,
  objectKey: string,
  context: DownloadContext,
): Promise<void> => {
  if (objectKey.includes('..') || objectKey.startsWith('/') || objectKey.includes('\\')) {
    throw new Error('invalid_object_key');
  }
  if (isOwnedUploadKey(callerId, objectKey)) return;

  if (context.chatId !== undefined) {
    const member = await getItem(chatPk(context.chatId), chatMemberSk(callerId));
    if (member === undefined) throw new Error('forbidden');
    if (await chatHasAttachment(context.chatId, objectKey)) return;
    throw new Error('forbidden');
  }

  if (context.userId !== undefined) {
    const profile = await getProfile(context.userId);
    if (profile?.photoKey !== objectKey) throw new Error('forbidden');
    if (context.userId === callerId) return;
    if (await sharesTeam(callerId, context.userId)) return;
    throw new Error('forbidden');
  }

  if (context.teamId !== undefined) {
    const member = await getItem(userPk(callerId), userTeamSk(context.teamId));
    if (member === undefined) throw new Error('forbidden');
    const team = await getItem<{ theme?: { logoKey?: string; chatBackgroundKey?: string } }>(
      teamPk(context.teamId),
      teamMetaSk(),
    );
    if (team?.theme?.logoKey === objectKey || team?.theme?.chatBackgroundKey === objectKey) return;
    throw new Error('forbidden');
  }

  throw new Error('forbidden');
};
