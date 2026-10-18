/**
 * `POST /identity/socket-ticket`
 */

import { verifyAuthHeader } from '../../../lib/auth/index.js';
import { authorizationOf, json, unauthorized } from '../../../lib/http.js';
import { route } from '../../../lib/pipeline.js';
import { issueSocketTicket } from '../../../lib/socket-ticket.js';
import { mapError } from './session.js';

/**
 * Handles `POST /identity/socket-ticket`.
 *
 * The bearer access token stays on this HTTP call. The response is an opaque
 * ticket the WebSocket authorizer burns on `$connect`.
 *
 * @param event - The HTTP API event.
 * @returns The ticket, or `401` when the caller is not authenticated.
 */
export const handleSocketTicket = route('POST', '/identity/socket-ticket', async ({ event }) => {
  try {
    const userId = (await verifyAuthHeader(authorizationOf(event))).userId;
    return json(200, await issueSocketTicket(userId));
  } catch (error) {
    return mapError(error) ?? unauthorized();
  }
});
