/**
 * Lambda authorizer for Amazon API Gateway WebSocket `$connect`.
 *
 * The browser WebSocket API cannot set an Authorization header. The client sends
 * a one-time ticket from `POST /identity/socket-ticket` as the `ticket` query
 * parameter. This function deletes that row and allows the user it names.
 *
 * Clients connect through the website distribution so the connect passes its
 * firewall. CloudFront adds {@link ORIGIN_VERIFY_HEADER}; a connect straight to
 * the `execute-api` hostname lacks it and is rejected before the ticket is used.
 * The expected value is read from Parameter Store, not the environment.
 */

import type {
  APIGatewayAuthorizerResult,
  APIGatewayRequestAuthorizerEvent,
} from 'aws-lambda';
import { readSecret } from '../../lib/parameters.js';
import { safeEqual } from '../../lib/safe-equal.js';
import { redeemSocketTicket } from '../../lib/socket-ticket.js';

/**
 * Header CloudFront adds to every socket connect it forwards.
 *
 * Must match `SOCKET_ORIGIN_VERIFY_HEADER` in `infrastructure/lib/site-api.ts`.
 */
export const ORIGIN_VERIFY_HEADER = 'x-origin-verify';

/**
 * Returns whether the connect carries the shared CloudFront secret.
 *
 * @param headers - The `$connect` request headers.
 * @returns `false` when the secret is unset, unreadable, missing, or different.
 */
const cameThroughCloudFront = async (
  headers: APIGatewayRequestAuthorizerEvent['headers'],
): Promise<boolean> => {
  const expected = await readSecret('ORIGIN_VERIFY_SECRET_PARAMETER', 'ORIGIN_VERIFY_SECRET');
  if (expected === undefined) return false;
  const received = Object.entries(headers ?? {}).find(
    ([name]) => name.toLowerCase() === ORIGIN_VERIFY_HEADER,
  )?.[1];
  return typeof received === 'string' && safeEqual(expected, received);
};

/**
 * Authorizes a WebSocket `$connect` request.
 *
 * @param event - The REQUEST authorizer event from Amazon API Gateway.
 * @returns An allow policy with the user id as the principal, or throws `Unauthorized`.
 */
export const handler = async (
  event: APIGatewayRequestAuthorizerEvent,
): Promise<APIGatewayAuthorizerResult> => {
  if (!(await cameThroughCloudFront(event.headers))) {
    throw new Error('Unauthorized');
  }

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
