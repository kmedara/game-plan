/**
 * The private chat for one driver's car: the driver and whoever is riding.
 */

import { randomUUID } from 'node:crypto';
import type { CarpoolOffer } from '@gameplan/types';
import {
  CHAT_MEMBER_SK_PREFIX,
  GUARDIAN_SK_PREFIX,
  TABLE_PK,
  TABLE_SK,
  chatMemberSk,
  chatMetaSk,
  chatPk,
  deleteItem,
  getItem,
  profileSk,
  putItem,
  queryBySkPrefix,
  userChatSk,
  userPk,
} from '../../lib/dynamo/index.js';

/** A stored offer, including the chat that belongs to this car. */
export type StoredCarpoolOffer = CarpoolOffer & { chatId?: string };

const CARPOOL_CHAT_NAME = 'Carpool';

/**
 * Drops the stored chat id so the carpool response stays the public offer.
 *
 * @param offer - The stored offer.
 * @returns The offer the API returns.
 */
export const publicCarpoolOffer = (offer: StoredCarpoolOffer): CarpoolOffer => ({
  userId: offer.userId,
  seats: offer.seats,
  riderIds: offer.riderIds,
});

/**
 * Linked guardians of a minor rider, so the carpool chat follows the same
 * adult-present rule as a private chat. Missing profiles are treated as adults.
 *
 * @param userId - A driver or rider.
 * @returns Guardian user ids, or none.
 */
const guardianIdsFor = async (userId: string): Promise<string[]> => {
  const profile = await getItem<{ accountKind?: string }>(userPk(userId), profileSk());
  if (profile?.accountKind !== 'minor') return [];
  const rows = await queryBySkPrefix<{ adultId?: string }>(userPk(userId), GUARDIAN_SK_PREFIX);
  return rows.flatMap((row) => (typeof row.adultId === 'string' ? [row.adultId] : []));
};

/**
 * Driver, current riders, and any linked guardians of minor riders.
 *
 * @param driverId - The person offering the seats.
 * @param riderIds - People currently in the car.
 * @returns The chat membership.
 */
const chatMemberIds = async (driverId: string, riderIds: readonly string[]): Promise<string[]> => {
  const ids = new Set([driverId, ...riderIds]);
  for (const userId of [...ids]) {
    for (const guardianId of await guardianIdsFor(userId)) ids.add(guardianId);
  }
  return [...ids];
};

const memberUserIds = async (chatId: string): Promise<string[]> => {
  const rows = await queryBySkPrefix<{ userId?: string }>(chatPk(chatId), CHAT_MEMBER_SK_PREFIX);
  return rows.flatMap((row) => (typeof row.userId === 'string' ? [row.userId] : []));
};

const putMembership = async (chatId: string, userId: string, joinedAt: string): Promise<void> => {
  await putItem({
    [TABLE_PK]: chatPk(chatId),
    [TABLE_SK]: chatMemberSk(userId),
    userId,
    joinedAt,
  });
  await putItem({
    [TABLE_PK]: userPk(userId),
    [TABLE_SK]: userChatSk(chatId),
    chatId,
    kind: 'private',
    name: CARPOOL_CHAT_NAME,
  });
};

const removeMembership = async (chatId: string, userId: string): Promise<void> => {
  await deleteItem(chatPk(chatId), chatMemberSk(userId));
  await deleteItem(userPk(userId), userChatSk(chatId));
};

const dissolveChat = async (chatId: string): Promise<void> => {
  const members = await memberUserIds(chatId);
  for (const userId of members) await removeMembership(chatId, userId);
  await deleteItem(chatPk(chatId), chatMetaSk());
};

/**
 * Makes the chat members match the driver and the current riders.
 *
 * @param chatId - The car's chat.
 * @param memberIds - Driver first, then riders.
 */
const ensureChat = async (chatId: string, memberIds: readonly string[]): Promise<void> => {
  const createdAt = new Date().toISOString();
  const meta = await getItem(chatPk(chatId), chatMetaSk());
  if (meta === undefined) {
    await putItem({
      [TABLE_PK]: chatPk(chatId),
      [TABLE_SK]: chatMetaSk(),
      chatId,
      kind: 'private',
      name: CARPOOL_CHAT_NAME,
      createdBy: memberIds[0],
      createdAt,
    });
  }
  const current = new Set(await memberUserIds(chatId));
  const desired = new Set(memberIds);
  for (const userId of current) {
    if (!desired.has(userId)) await removeMembership(chatId, userId);
  }
  for (const userId of desired) {
    if (!current.has(userId)) await putMembership(chatId, userId, createdAt);
  }
};

/**
 * Opens, joins, or closes the chat for each car whose riders changed.
 *
 * A car with at least one rider has one chat. The first rider creates it with
 * the driver. A later rider is added to that same chat. A rider who leaves, or
 * the last rider, is removed, and an empty car's chat is deleted.
 *
 * @param previous - Offers before this write.
 * @param next - Offers after this write, still carrying any chat id they had.
 * @returns The next offers with chat ids kept or cleared.
 */
export const syncCarpoolChats = async (
  previous: readonly StoredCarpoolOffer[],
  next: readonly StoredCarpoolOffer[],
): Promise<StoredCarpoolOffer[]> => {
  const driverIds = new Set([
    ...previous.map((offer) => offer.userId),
    ...next.map((offer) => offer.userId),
  ]);
  const result = next.map((offer) => ({ ...offer }));
  for (const driverId of driverIds) {
    const before = previous.find((offer) => offer.userId === driverId);
    const afterIndex = result.findIndex((offer) => offer.userId === driverId);
    const after = afterIndex === -1 ? undefined : result[afterIndex];
    const riders = after?.riderIds ?? [];
    if (after === undefined || riders.length === 0) {
      if (before?.chatId !== undefined) await dissolveChat(before.chatId);
      if (after !== undefined) {
        const { chatId: _chatId, ...rest } = after;
        result[afterIndex] = rest;
      }
      continue;
    }
    const chatId = before?.chatId ?? randomUUID();
    await ensureChat(chatId, await chatMemberIds(driverId, riders));
    result[afterIndex] = { ...after, chatId };
  }
  return result;
};
