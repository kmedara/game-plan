/**
 * Unit tests for HTTP route guards.
 */

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { json } from './http.js';
import { route, withBodyValidation } from './pipeline.js';

const mockGetItem = vi.fn();
const mockLoadMatrix = vi.fn();

vi.mock('./dynamo/access.js', () => ({
  getItem: (...args: unknown[]) => mockGetItem(...args),
}));

vi.mock('./permissions.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./permissions.js')>()),
  loadRolePermissionMatrix: (...args: unknown[]) => mockLoadMatrix(...args),
}));

const {
  requireMembership,
  requirePermission,
  requireTeam,
  requireUser,
  withTeamIdFromBody,
} = await import('./guards.js');
const { issueLocalTokens } = await import('./auth/index.js');

process.env.LOCAL_JWT_SECRET = 'guards-test-secret';
const { accessToken } = issueLocalTokens('guard-user', 'guard@example.com');

/**
 * Builds a minimal HTTP API event.
 *
 * @returns An HTTP API event.
 */
const event = (): APIGatewayProxyEventV2 =>
  ({
    version: '2.0',
    rawPath: '/',
    headers: { authorization: `Bearer ${accessToken}` },
    requestContext: {
      http: { method: 'GET', path: '/' },
    },
  }) as unknown as APIGatewayProxyEventV2;

describe('guards', () => {
  beforeEach(() => {
    mockGetItem.mockReset();
    mockLoadMatrix.mockReset();
  });

  it('requireUser attaches the authenticated user', async () => {
    const handle = route(requireUser(), async (ctx) => json(200, { userId: ctx.user.userId }));
    const result = await handle(event());
    expect(JSON.parse(result.body ?? '')).toEqual({ userId: 'guard-user' });
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

    mockGetItem.mockResolvedValueOnce({ role: 123 });
    const badRole = route(['teamId'], requireUser(), requireMembership(), async () =>
      json(200, {}),
    );
    await expect(badRole(event(), 't1')).rejects.toThrow('not_a_member');
  });

  it('requirePermission checks the loaded member roles without re-reading the roster', async () => {
    const allowed = route(
      withBodyValidation(z.object({ teamId: z.string() })),
      withTeamIdFromBody(),
      requireUser(),
      requireMembership(),
      requirePermission('invite_members'),
      async (ctx) => json(200, { teamId: ctx.teamId }),
    );
    const postEvent = {
      ...event(),
      requestContext: {
        http: { method: 'POST', path: '/' },
      },
      body: JSON.stringify({ teamId: 'team-body' }),
    } as unknown as APIGatewayProxyEventV2;

    mockGetItem.mockResolvedValueOnce({ role: 'parent', roles: ['parent', 'coach'] });
    mockLoadMatrix.mockResolvedValueOnce({ coach: ['invite_members'], parent: [] });
    const ok = await allowed(postEvent);
    expect(JSON.parse(ok.body ?? '')).toEqual({ teamId: 'team-body' });
    expect(mockGetItem).toHaveBeenCalledTimes(1);
    expect(mockLoadMatrix).toHaveBeenCalledWith('team-body');

    mockGetItem.mockResolvedValueOnce({ role: 'player' });
    mockLoadMatrix.mockResolvedValueOnce({ player: [] });
    await expect(allowed(postEvent)).rejects.toThrow('forbidden');
  });
});
