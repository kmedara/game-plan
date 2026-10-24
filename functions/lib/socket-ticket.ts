/**
 * One-time tickets that authorize a WebSocket `$connect` without putting the
 * Cognito access token on the URL.
 */

import { randomBytes } from 'node:crypto';
import {
  SOCKET_TICKET_TTL_SECONDS,
  TABLE_PK,
  TABLE_SK,
  putItem,
  redeemOnce,
  ticketPk,
  ticketSk,
  type UserId,
} from './dynamo/index.js';

/** Ticket returned to the signed-in client. */
export type IssuedSocketTicket = {
  ticket: string;
  expiresIn: number;
};

/** Stored ticket row under `TICKET#<id>` / `TICKET`. */
type SocketTicketItem = {
  PK: string;
  SK: string;
  userId: string;
  ttl: number;
};

/**
 * Writes a random ticket for the authenticated user.
 *
 * @param userId - The Cognito `sub` allowed to open the socket.
 * @returns The opaque ticket and its lifetime in seconds.
 */
export const issueSocketTicket = async (userId: UserId): Promise<IssuedSocketTicket> => {
  const ticket = randomBytes(32).toString('base64url');
  const item: SocketTicketItem = {
    [TABLE_PK]: ticketPk(ticket),
    [TABLE_SK]: ticketSk(),
    userId,
    ttl: Math.floor(Date.now() / 1000) + SOCKET_TICKET_TTL_SECONDS,
  };
  await putItem(item);
  return { ticket, expiresIn: SOCKET_TICKET_TTL_SECONDS };
};

/**
 * Deletes a ticket and returns the user it was issued for.
 *
 * A second call finds nothing, and an expired ticket is refused.
 *
 * @param ticket - The opaque id from the socket query string.
 * @returns The user id, or `undefined` when the ticket cannot be used.
 */
export const redeemSocketTicket = async (ticket: string): Promise<UserId | undefined> => {
  if (ticket.length === 0) return undefined;
  const userId = (await redeemOnce(ticketPk(ticket), ticketSk()))?.userId;
  return typeof userId === 'string' && userId.length > 0 ? userId : undefined;
};
