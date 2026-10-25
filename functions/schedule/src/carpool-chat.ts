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
 * Gives each car with riders its chat id, and takes it off an empty car.
 *
 * A car keeps the chat it already had; the first rider gets a new id. This
 * only decides the ids, so they can be stored with the offers before any chat
 * is touched; {@link syncCarpoolChats} then makes the chats match.
 *
 * @param previous - Offers as stored before this write.
 * @param next - Offers after this write.
 * @returns The next offers with chat ids kept, added, or cleared.
 */
export const withCarpoolChatIds = (
  previous: readonly StoredCarpoolOffer[],
  next: readonly StoredCarpoolOffer[],
): StoredCarpoolOffer[] =>
  next.map((offer) => {
    const { chatId, ...rest } = offer;
    if (offer.riderIds.length === 0) return rest;
    const before = previous.find((row) => row.userId === offer.userId);
    return { ...rest, chatId: chatId ?? before?.chatId ?? randomUUID() };
  });

/**
 * Opens, joins, or closes the chat for each car, to match offers that were stored.
 *
 * A car with at least one rider has one chat. The first rider creates it with
 * the driver. A later rider is added to that same chat. A rider who leaves is
 * removed, and the chat of a car that emptied or was withdrawn is deleted.
 *
 * Call this only after the offers are stored, so a write that lost a race
 * leaves no chat or member behind.
 *
 * @param previous - Offers as stored before the write.
 * @param stored - Offers as stored by the write, from {@link withCarpoolChatIds}.
 */
export const syncCarpoolChats = async (
  previous: readonly StoredCarpoolOffer[],
  stored: readonly StoredCarpoolOffer[],
): Promise<void> => {
  const kept = new Set(stored.flatMap((offer) => (offer.chatId !== undefined ? [offer.chatId] : [])));
  for (const offer of previous) {
    if (offer.chatId !== undefined && !kept.has(offer.chatId)) await dissolveChat(offer.chatId);
  }
  for (const offer of stored) {
    if (offer.chatId !== undefined) await ensureChat(offer.chatId, await chatMemberIds(offer.userId, offer.riderIds));
  }
};
