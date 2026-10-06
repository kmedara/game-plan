/**
 * Teams error mapper and pipeline wrapper coverage.
 */

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { route } from '../../../lib/pipeline.js';
import { mapTeamsError, withTeamsErrors } from './errors.js';

describe('mapTeamsError', () => {
  it('returns undefined for non-Error values', () => {
    expect(mapTeamsError('nope')).toBeUndefined();
  });

  it('maps auth, not-found, forbidden, conflict, and bad-request messages', () => {
    expect(mapTeamsError(new Error('unauthorized'))?.statusCode).toBe(401);
    expect(mapTeamsError(new Error('invalid_token'))?.statusCode).toBe(401);
    expect(mapTeamsError(new Error('token_expired'))?.statusCode).toBe(401);
    expect(mapTeamsError(new Error('team_not_found'))?.statusCode).toBe(404);
    expect(mapTeamsError(new Error('invite_not_found'))?.statusCode).toBe(404);
    expect(mapTeamsError(new Error('join_request_not_found'))?.statusCode).toBe(404);
    expect(mapTeamsError(new Error('profile_not_found'))?.statusCode).toBe(404);
    expect(mapTeamsError(new Error('not_a_member'))?.statusCode).toBe(403);
    expect(mapTeamsError(new Error('forbidden'))?.statusCode).toBe(403);
    expect(mapTeamsError(new Error('minor_cannot_create_team'))?.statusCode).toBe(403);
    expect(mapTeamsError(new Error('minor_cannot_be_team_admin'))?.statusCode).toBe(403);
    expect(mapTeamsError(new Error('minor_cannot_hold_manage_permissions'))?.statusCode).toBe(403);
    expect(mapTeamsError(new Error('already_a_member'))?.statusCode).toBe(409);
    expect(mapTeamsError(new Error('join_request_exists'))?.statusCode).toBe(409);
    expect(mapTeamsError(new Error('manage_permissions_required_for_team_admin'))?.statusCode).toBe(
      400,
    );
    expect(mapTeamsError(new Error('invalid_body'))?.statusCode).toBe(400);
    expect(mapTeamsError(new Error('too_many_positions'))?.statusCode).toBe(400);
    expect(mapTeamsError(new Error('TransactionCanceledException'))?.statusCode).toBe(409);
  });

  it('maps DynamoDB exception names in the default branch', () => {
    const conditional = new Error('x');
    conditional.name = 'ConditionalCheckFailedException';
    expect(mapTeamsError(conditional)?.statusCode).toBe(409);

    const transaction = new Error('x');
    transaction.name = 'TransactionCanceledException';
    expect(mapTeamsError(transaction)?.statusCode).toBe(409);

    expect(mapTeamsError(new Error('unknown'))).toBeUndefined();
  });
});

describe('withTeamsErrors', () => {
  it('logs unmapped errors and returns 500', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const httpEvent = (): APIGatewayProxyEventV2 =>
      ({
        version: '2.0',
        rawPath: '/',
        headers: {},
        requestContext: { http: { method: 'GET', path: '/' } },
      }) as APIGatewayProxyEventV2;

    const handle = route(
      withTeamsErrors(),
      async () => {
        throw new Error('unexpected');
      },
    );
    const result = await handle(httpEvent());
    expect(result.statusCode).toBe(500);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('maps a known throw from a later step', async () => {
    const handle = route(
      withTeamsErrors(),
      async () => {
        throw new Error('team_not_found');
      },
    );
    await expect(
      handle({
        version: '2.0',
        rawPath: '/',
        headers: {},
        requestContext: { http: { method: 'GET', path: '/' } },
      } as APIGatewayProxyEventV2),
    ).resolves.toMatchObject({ statusCode: 404 });
  });
});
