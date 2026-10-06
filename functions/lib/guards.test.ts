/**
 * Unit tests for HTTP route guards.
 */

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { json } from './http.js';
import { route, withBodyValidation } from './pipeline.js';

const mockGetItem = vi.fn();
const mockCan = vi.fn();

vi.mock('./dynamo/access.js', () => ({
  getItem: (...args: unknown[]) => mockGetItem(...args),
}));

vi.mock('./permissions.js', () => ({
  can: (...args: unknown[]) => mockCan(...args),
}));

const {
  assertPermission,
  requireMembership,
  requirePermission,
  requireTeam,
  requireUser,
  withTeamIdFromBody,
} = await import('./guards.js');

/**
 * Builds a minimal HTTP API event.
 *
 * @returns An HTTP API event.
 */
const event = (): APIGatewayProxyEventV2 =>
  ({
    version: '2.0',
    rawPath: '/',
    headers: { authorization: 'Bearer unused' },
    requestContext: {
      http: { method: 'GET', path: '/' },
      authorizer: { jwt: { claims: { sub: 'guard-user' } } },
    },
  }) as APIGatewayProxyEventV2;

describe('guards', () => {
  beforeEach(() => {
    mockGetItem.mockReset();
    mockCan.mockReset();
    process.env.AUTH_DISABLED = 'true';
    process.env.AUTH_SEED_USER_ID = 'seed-user';
  });

  afterEach(() => {
    delete process.env.AUTH_DISABLED;
    delete process.env.AUTH_SEED_USER_ID;
  });

  it('assertPermission throws when can returns false', async () => {
    mockCan.mockResolvedValueOnce(false);
    await expect(assertPermission('u1', 't1', 'manage_events')).rejects.toThrow('forbidden');
    mockCan.mockResolvedValueOnce(true);
    await expect(assertPermission('u1', 't1', 'manage_events')).resolves.toBeUndefined();
  });

  it('requireUser attaches the authenticated user', async () => {
    const handle = route(requireUser(), async (ctx) => json(200, { userId: ctx.user.userId }));
    const result = await handle(event());
    expect(JSON.parse(result.body ?? '')).toEqual({ userId: 'seed-user' });
  });

  it('requireTeam and requireMembership load team rows', async () => {
    mockGetItem.mockResolvedValueOnce({ teamId: 't1' });
    const teamHandle = route(['teamId'], requireTeam(), async (ctx) =>
      json(200, { teamId: ctx.team.teamId }),
    );
    await expect(teamHandle(event(), 't1')).resolves.toMatchObject({ statusCode: 200 });

    mockGetItem.mockResolvedValueOnce(undefined);
    const missingTeam = route(['teamId'], requireTeam(), async () => json(200, {}));
    await expect(missingTeam(event(), 'missing')).rejects.toThrow('team_not_found');

    mockGetItem.mockResolvedValueOnce({ role: 'coach' });
    const memberHandle = route(
      ['teamId'],
      requireUser(),
      requireMembership(),
      async (ctx) => json(200, { role: ctx.member.role }),
    );
    await expect(memberHandle(event(), 't1')).resolves.toMatchObject({ statusCode: 200 });

    mockGetItem.mockResolvedValueOnce(undefined);
    const notMember = route(['teamId'], requireUser(), requireMembership(), async () =>
      json(200, {}),
    );
    await expect(notMember(event(), 't1')).rejects.toThrow('not_a_member');
  });

  it('requirePermission and withTeamIdFromBody enforce team scope', async () => {
    mockCan.mockResolvedValueOnce(true);
    const allowed = route(
      withBodyValidation(z.object({ teamId: z.string() })),
      withTeamIdFromBody(),
      requireUser(),
      requirePermission('invite_members'),
      async (ctx) => json(200, { teamId: ctx.teamId }),
    );
    const ok = await allowed({
      ...event(),
      requestContext: { http: { method: 'POST', path: '/' } },
      body: JSON.stringify({ teamId: 'team-body' }),
    } as APIGatewayProxyEventV2);
    expect(JSON.parse(ok.body ?? '')).toEqual({ teamId: 'team-body' });

    mockCan.mockResolvedValueOnce(false);
    await expect(
      allowed({
        ...event(),
        requestContext: { http: { method: 'POST', path: '/' } },
        body: JSON.stringify({ teamId: 'team-body' }),
      } as APIGatewayProxyEventV2),
    ).rejects.toThrow('forbidden');

    mockGetItem.mockResolvedValueOnce({ role: 123 });
    const badRole = route(['teamId'], requireUser(), requireMembership(), async () =>
      json(200, {}),
    );
    await expect(badRole(event(), 't1')).rejects.toThrow('not_a_member');
  });
});
