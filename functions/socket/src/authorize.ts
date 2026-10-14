/**
 * Lambda authorizer for Amazon API Gateway WebSocket `$connect`.
 *
 * The browser WebSocket API cannot set an Authorization header. The client sends
 * a one-time ticket from `POST /identity/socket-ticket` as the `ticket` query
 * parameter. This function deletes that row and allows the user it names.
 */

import type {
  APIGatewayAuthorizerResult,
  APIGatewayRequestAuthorizerEvent,
} from 'aws-lambda';
import { redeemSocketTicket } from '../../lib/socket-ticket.js';

/**
 * Authorizes a WebSocket `$connect` request.
 *
 * @param event - The REQUEST authorizer event from Amazon API Gateway.
 * @returns An allow policy with the user id as the principal, or throws `Unauthorized`.
 */
export const handler = async (
  event: APIGatewayRequestAuthorizerEvent,
): Promise<APIGatewayAuthorizerResult> => {
  const ticket = event.queryStringParameters?.ticket;
  if (ticket === undefined || ticket.length === 0) {
    throw new Error('Unauthorized');
  }

  try {
    const userId = await redeemSocketTicket(ticket);
    if (userId === undefined) throw new Error('Unauthorized');
    return {
      principalId: userId,
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Action: 'execute-api:Invoke',
            Effect: 'Allow',
            Resource: event.methodArn,
          },
        ],
      },
      context: { sub: userId },
    };
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') throw error;
    throw new Error('Unauthorized');
  }
};
