/**
 * Resolves the authenticated user id on a WebSocket `$connect` event.
 *
 * Cloud `$connect` carries the Lambda authorizer context. Local connect redeems
 * the `ticket` query parameter because the local server has no authorizer.
 */

import type { APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';
import { redeemSocketTicket } from '../../lib/socket-ticket.js';

/**
 * Reads a string field from an unknown authorizer context object.
 *
 * @param authorizer - The `requestContext.authorizer` value.
 * @param key - The claim or context key to read.
 * @returns The string value, or `undefined`.
 */
const authorizerString = (
  authorizer: unknown,
  key: string,
): string | undefined => {
  if (typeof authorizer !== 'object' || authorizer === null) return undefined;
  const record = authorizer as Record<string, unknown>;
  const direct = record[key];
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const nested = record.lambda;
  if (typeof nested === 'object' && nested !== null) {
    const value = (nested as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
};

/**
 * Resolves the user id for a WebSocket connect.
 *
 * @param event - The WebSocket API event.
 * @returns The authenticated user id.
 * @throws When no trusted identity is present.
 */
export const resolveConnectUserId = async (
  event: APIGatewayProxyWebsocketEventV2,
): Promise<string> => {
  const authorizer = (
    event.requestContext as APIGatewayProxyWebsocketEventV2['requestContext'] & {
      authorizer?: unknown;
    }
  ).authorizer;

  const fromContext =
    authorizerString(authorizer, 'sub') ?? authorizerString(authorizer, 'principalId');
  if (fromContext !== undefined) return fromContext;

  const ticket = event.queryStringParameters?.ticket;
  if (ticket === undefined || ticket.length === 0) {
    throw new Error('unauthorized');
  }
  const userId = await redeemSocketTicket(ticket);
  if (userId === undefined) throw new Error('unauthorized');
  return userId;
};
