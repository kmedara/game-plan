/**
 * `POST /identity/socket-ticket`
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { verifyAuthHeader } from '../../../lib/auth/index.js';
import { headerOf, json, unauthorized } from '../../../lib/http.js';
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
export const handleSocketTicket = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> => {
  try {
    const userId = (await verifyAuthHeader(headerOf(event, 'authorization'))).userId;
    return json(200, await issueSocketTicket(userId));
  } catch (error) {
    return mapError(error) ?? unauthorized();
  }
};
