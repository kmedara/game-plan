/**
 * Route guards shared by area HTTP handlers.
 */

import type { AuthUser, TeamPermission } from '@gameplan/types';
import { asStep, type Step } from '../pipeline.js';
import { can } from '../permissions.js';
import { authenticateRequest } from './cognito.js';

/**
 * Ensures the caller holds a team permission.
 *
 * Use this when the team id comes from the body rather than the path.
 * Path routes should use {@link requirePermission} instead.
 *
 * @param userId - The caller's user id.
 * @param teamId - The team under test.
 * @param permission - The required permission.
 */
export const assertPermission = async (
  userId: string,
  teamId: string,
  permission: TeamPermission,
): Promise<void> => {
  if (!(await can(userId, teamId, permission))) {
    throw new Error('forbidden');
  }
};

/**
 * Authenticates the HTTP request and attaches `user`.
 *
 * @returns A step that throws `unauthorized` when no trusted identity is present.
 */
export const requireUser = (): Step<object, { user: AuthUser }> =>
  asStep<object, { user: AuthUser }>(async (ctx, next) => {
    const user = await authenticateRequest(ctx.event);
    return next({ ...ctx, user });
  });

/**
 * Ensures the caller holds a team permission.
 *
 * The context must already include `user` and `teamId`.
 *
 * @param permission - The required permission.
 * @returns A step that throws `forbidden` when the permission is missing.
 */
export const requirePermission = (
  permission: TeamPermission,
): Step<{ user: AuthUser; teamId: string }, object> =>
  asStep<{ user: AuthUser; teamId: string }, object>(async (ctx, next) => {
    await assertPermission(ctx.user.userId, ctx.teamId, permission);
    return next(ctx);
  });
