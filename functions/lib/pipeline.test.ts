/**
 * Pipeline order, validation short-circuit, and accumulated context.
 */

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { requirePermission, requireUser } from './auth/require.js';
import { json } from './http.js';
import {
  asStep,
  route,
  withBodyValidation,
  withMappedErrors,
  type HttpResult,
} from './pipeline.js';

/**
 * Builds a minimal HTTP API event.
 *
 * @param body - Optional JSON body.
 * @returns An HTTP API event.
 */
const httpEvent = (body?: unknown): APIGatewayProxyEventV2 =>
  ({
    version: '2.0',
    rawPath: '/',
    headers: {},
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { http: { method: 'POST', path: '/' } },
  }) as APIGatewayProxyEventV2;

describe('route pipeline', () => {
  it('maps a throw from a later step', async () => {
    const handle = route(
      withMappedErrors(() => json(418, { error: 'mapped' })),
      async () => {
        throw new Error('nope');
      },
    );

    await expect(handle(httpEvent())).resolves.toEqual(json(418, { error: 'mapped' }));
  });

  it('returns 400 and does not call the handler when the body is invalid', async () => {
    const run = vi.fn(async () => json(200, { ok: true }));
    const handle = route(withBodyValidation(z.object({ name: z.string().min(1) })), run);

    const result = await handle(httpEvent({}));

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body ?? '')).toEqual({
      errors: [{ field: 'name', message: expect.any(String) }],
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('skips steps after one that returns a response', async () => {
    const stop = asStep<object, object>(async () => json(204, { stopped: true }));
    const skipped = vi.fn(asStep<object, object>(async (ctx, next) => next(ctx)));
    const handle = route(stop, skipped, async () => json(200, { reached: true }));

    await expect(handle(httpEvent())).resolves.toEqual(json(204, { stopped: true }));
    expect(skipped).not.toHaveBeenCalled();
  });

  describe('accumulated context', () => {
    const previousDisabled = process.env.AUTH_DISABLED;
    const previousSeed = process.env.AUTH_SEED_USER_ID;

    afterEach(() => {
      if (previousDisabled === undefined) delete process.env.AUTH_DISABLED;
      else process.env.AUTH_DISABLED = previousDisabled;
      if (previousSeed === undefined) delete process.env.AUTH_SEED_USER_ID;
      else process.env.AUTH_SEED_USER_ID = previousSeed;
    });

    it('passes path args, user, and body to the handler', async () => {
      process.env.AUTH_DISABLED = 'true';
      process.env.AUTH_SEED_USER_ID = 'user-1';

      const handle = route(
        ['teamId'],
        withBodyValidation(z.object({ name: z.string() })),
        requireUser(),
        async (ctx) =>
          json(200, { teamId: ctx.teamId, userId: ctx.user.userId, name: ctx.body.name }),
      );

      const result = await handle(httpEvent({ name: 'Wildcats' }), 'team-1');
      expect(JSON.parse(result.body ?? '')).toEqual({
        teamId: 'team-1',
        userId: 'user-1',
        name: 'Wildcats',
      });
    });
  });
});

const _typedPermission = route(
  ['teamId'],
  requireUser(),
  requirePermission('manage_events'),
  async (ctx): HttpResult => json(200, { userId: ctx.user.userId, teamId: ctx.teamId }),
);

// @ts-expect-error permission requires a user already on the context
route(requirePermission('manage_events'), async () => json(200, {}));

void _typedPermission;
