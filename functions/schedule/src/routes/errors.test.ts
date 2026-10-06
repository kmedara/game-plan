/**
 * Schedule error mapper coverage.
 */

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { route } from '../../../lib/pipeline.js';
import { mapScheduleError, withScheduleErrors } from './errors.js';

describe('mapScheduleError', () => {
  it('returns undefined for non-Error values', () => {
    expect(mapScheduleError('nope')).toBeUndefined();
  });

  it('maps every known schedule domain message', () => {
    const unauthorized = ['unauthorized', 'invalid_token', 'token_expired'] as const;
    for (const message of unauthorized) {
      expect(mapScheduleError(new Error(message))?.statusCode).toBe(401);
    }

    for (const message of ['team_not_found', 'event_not_found', 'occurrence_not_found'] as const) {
      expect(mapScheduleError(new Error(message))?.statusCode).toBe(404);
    }

    for (const message of ['not_a_member', 'forbidden'] as const) {
      expect(mapScheduleError(new Error(message))?.statusCode).toBe(403);
    }

    for (const message of [
      'invalid_window',
      'window_too_large',
      'invalid_from',
      'invalid_to',
      'invalid_starts_at',
      'invalid_ends_at',
      'invalid_until',
      'invalid_by_week_day',
      'invalid_occurrence_starts_at',
      'invalid_body',
    ] as const) {
      expect(mapScheduleError(new Error(message))?.statusCode).toBe(400);
    }

    const conditional = new Error('x');
    conditional.name = 'ConditionalCheckFailedException';
    expect(mapScheduleError(conditional)?.statusCode).toBe(409);
    expect(mapScheduleError(new Error('unknown'))).toBeUndefined();
  });
});

describe('withScheduleErrors', () => {
  it('logs unmapped errors and returns 500', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const handle = route(
      withScheduleErrors(),
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
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
