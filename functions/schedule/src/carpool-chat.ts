/**
 * The private chat for one driver's car: the driver and whoever is riding.
 */

import { randomUUID } from 'node:crypto';
import { requiredGuardianIds } from '@gameplan/rules';
import type { CarpoolOffer } from '@gameplan/types';
import {
  TABLE_PK,
  TABLE_SK,
  chatMetaSk,
  chatPk,
  deleteItem,
  getItem,
  profileSk,
  putItem,
  userPk,
} from '../../lib/dynamo/index.js';
import { refreshChatMemberNames } from '../../lib/chat-member-names.js';
import { listChatMemberIds, removeChatMember, syncChatMembers } from '../../lib/chat-membership.js';
import { listGuardianIds } from '../../lib/guardians.js';

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
 * Driver, current riders, and the guardians the private-chat rule requires.
 *
 * Missing profiles are treated as adults.
 *
 * @param driverId - The person offering the seats.
 * @param riderIds - People currently in the car.
 * @returns The chat membership.
 */
const chatMemberIds = async (driverId: string, riderIds: readonly string[]): Promise<string[]> => {
  const ids = [...new Set([driverId, ...riderIds])];
  const people = await Promise.all(
    ids.map(async (userId) => {
      const profile = await getItem<{ accountKind?: string }>(userPk(userId), profileSk());
      const accountKind = profile?.accountKind === 'minor' ? ('minor' as const) : ('adult' as const);
      return {
        userId,
        accountKind,
        ...(accountKind === 'minor' ? { guardianIds: await listGuardianIds(userId) } : {}),
      };
    }),
  );
  return [...ids, ...requiredGuardianIds(people)];
};

const dissolveChat = async (chatId: string): Promise<void> => {
  for (const userId of await listChatMemberIds(chatId)) await removeChatMember(chatId, userId);
  await deleteItem(chatPk(chatId), chatMetaSk());
};

/**
 * Makes the chat members match the driver and the current riders, and
 * rewrites the stored member names when anyone joined or left.
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
  const changed = await syncChatMembers(
    { chatId, kind: 'private', name: CARPOOL_CHAT_NAME },
    memberIds,
    createdAt,
  );
  if (changed || meta === undefined) await refreshChatMemberNames(chatId);
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
