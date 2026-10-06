/**
 * Unit tests for the WebSocket `$connect` Cognito authorizer.
 */

import type { APIGatewayRequestAuthorizerEvent } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import { handler } from './authorize.js';

/**
 * Builds a REQUEST authorizer event with an optional access token query parameter.
 *
 * @param token - The `token` query value, or omit to leave the map empty.
 * @returns An Amazon API Gateway REQUEST authorizer event.
 */
const event = (token?: string): APIGatewayRequestAuthorizerEvent =>
  ({
    type: 'REQUEST',
    methodArn: 'arn:aws:execute-api:us-east-1:000000000000:api/prod/$connect',
    queryStringParameters: token === undefined ? null : { token },
    headers: {},
  }) as APIGatewayRequestAuthorizerEvent;

describe('socket authorizer', () => {
  it('rejects a connect that has no token', async () => {
    await expect(handler(event())).rejects.toThrow('Unauthorized');
  });

  it('rejects a token when the user pool is not configured', async () => {
    delete process.env.COGNITO_USER_POOL_ID;
    delete process.env.COGNITO_CLIENT_ID;
    await expect(handler(event('not-a-jwt'))).rejects.toThrow('Unauthorized');
  });
});
