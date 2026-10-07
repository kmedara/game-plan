/**
 * Chat error mapper coverage.
 */

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import { route } from '../../../lib/pipeline.js';
import { mapChatError, withChatErrors } from './errors.js';

describe('mapChatError', () => {
  it('returns undefined for non-Error values', () => {
    expect(mapChatError('nope')).toBeUndefined();
  });

  it('maps known messages and DynamoDB names', () => {
    expect(mapChatError(new Error('unauthorized'))?.statusCode).toBe(401);
    expect(mapChatError(new Error('invalid_token'))?.statusCode).toBe(401);
    expect(mapChatError(new Error('token_expired'))?.statusCode).toBe(401);
    expect(mapChatError(new Error('user_not_found'))?.statusCode).toBe(404);
    expect(JSON.parse(mapChatError(new Error('user_not_found'))?.body ?? '{}')).toEqual({
      error: 'user_not_found',
    });
    expect(mapChatError(new Error('team_not_found'))?.statusCode).toBe(404);
    expect(mapChatError(new Error('chat_not_found'))?.statusCode).toBe(404);
    expect(mapChatError(new Error('profile_not_found'))?.statusCode).toBe(404);
    expect(mapChatError(new Error('not_a_member'))?.statusCode).toBe(403);
    expect(mapChatError(new Error('not_a_chat_member'))?.statusCode).toBe(403);
    expect(mapChatError(new Error('forbidden'))?.statusCode).toBe(403);
    expect(mapChatError(new Error('minor_chat_rule_violated'))?.statusCode).toBe(403);
    expect(mapChatError(new Error('invalid_body'))?.statusCode).toBe(400);
    expect(mapChatError(new Error('invalid_attachment_key'))?.statusCode).toBe(400);

    const conditional = new Error('x');
    conditional.name = 'ConditionalCheckFailedException';
    expect(mapChatError(conditional)?.statusCode).toBe(409);

    const transaction = new Error('x');
    transaction.name = 'TransactionCanceledException';
    expect(mapChatError(transaction)?.statusCode).toBe(409);

    expect(mapChatError(new Error('unknown'))).toBeUndefined();
  });
});

describe('withChatErrors', () => {
  it('returns 500 for unmapped errors', async () => {
    const handle = route(
      withChatErrors(),
      async () => {
        throw new Error('unexpected');
      },
    );
    const result = await handle({
      version: '2.0',
      rawPath: '/',
      headers: {},
      requestContext: { http: { method: 'GET', path: '/' } },
    } as APIGatewayProxyEventV2);
    expect(result.statusCode).toBe(500);
  });
});
