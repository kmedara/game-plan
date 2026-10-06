/**
 * Unit tests for the WebSocket `$connect` Cognito authorizer.
 */

import type { APIGatewayRequestAuthorizerEvent } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { issueLocalTokens } from '../../lib/auth/local-jwt.js';
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
  beforeEach(() => {
    delete process.env.COGNITO_USER_POOL_ID;
    delete process.env.COGNITO_CLIENT_ID;
    process.env.LOCAL_JWT_SECRET = 'socket-authorizer-test-secret';
  });

  afterEach(() => {
    delete process.env.AUTH_DISABLED;
    delete process.env.AUTH_SEED_USER_ID;
  });

  it('rejects a connect that has no token', async () => {
    await expect(handler(event())).rejects.toThrow('Unauthorized');
  });

  it('rejects a token when the user pool is not configured and the JWT is invalid', async () => {
    await expect(handler(event('not-a-jwt'))).rejects.toThrow('Unauthorized');
  });

  it('allows a valid local access token', async () => {
    const { accessToken } = issueLocalTokens('user-1', 'user-1@example.com');
    const result = await handler(event(accessToken));
    expect(result.principalId).toBe('user-1');
    expect(result.context).toEqual({ sub: 'user-1' });
    expect(result.policyDocument.Statement[0]?.Effect).toBe('Allow');
  });
});
