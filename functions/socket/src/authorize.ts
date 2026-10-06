/**
 * Lambda authorizer for Amazon API Gateway WebSocket `$connect`.
 *
 * The browser WebSocket API cannot set an Authorization header, so the Cognito access
 * token arrives as the `token` query string parameter.
 */

import type {
  APIGatewayAuthorizerResult,
  APIGatewayRequestAuthorizerEvent,
} from 'aws-lambda';
import { verifyAccessToken } from '../../lib/auth/cognito.js';

/**
 * Authorizes a WebSocket `$connect` request.
 *
 * @param event - The REQUEST authorizer event from Amazon API Gateway.
 * @returns An allow policy with the Cognito `sub` as the principal, or throws `Unauthorized`.
 */
export const handler = async (
  event: APIGatewayRequestAuthorizerEvent,
): Promise<APIGatewayAuthorizerResult> => {
  const token = event.queryStringParameters?.token;
  if (token === undefined) {
    throw new Error('Unauthorized');
  }

  try {
    const user = await verifyAccessToken(token);
    return {
      principalId: user.userId,
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
      context: { sub: user.userId },
    };
  } catch {
    throw new Error('Unauthorized');
  }
};
