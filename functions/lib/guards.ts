/**
 * HTTP route guards shared by every area Lambda.
 */

import type { AuthUser, TeamPermission, TeamRole } from '@gameplan/types';
import { authenticateRequest } from './auth/cognito.js';
import { getItem } from './dynamo/access.js';
import { teamMemberSk, teamMetaSk, teamPk } from './dynamo/keys.js';
import { can } from './permissions.js';
import { asStep, type Step } from './pipeline.js';

/** Team identity confirmed by {@link requireTeam}. */
export type GuardTeam = {
  teamId: string;
};

/** Roster membership loaded by {@link requireMembership}. */
export type GuardMember = {
  userId: string;
  role: TeamRole;
};

/**
 * Ensures the caller holds a team permission (used by {@link requirePermission}).
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
 * Copies `body.teamId` onto the context as `teamId` for path-style guards.
 *
 * Use before {@link requirePermission} when the team id is on the body.
 *
 * @returns A step that attaches `teamId` from the validated body.
 */
export const withTeamIdFromBody = (): Step<
  { body: { teamId: string } },
  { teamId: string }
> =>
  asStep<{ body: { teamId: string } }, { teamId: string }>(async (ctx, next) =>
    next({ ...ctx, teamId: ctx.body.teamId }),
  );

/**
 * Ensures the caller holds a team permission.
 *
 * The context must already include `user` and `teamId` (from the path or
 * {@link withTeamIdFromBody}).
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

/**
 * Ensures the team named by `teamId` exists and attaches `team`.
 *
 * @returns A step that throws `team_not_found` when the team does not exist.
 */
export const requireTeam = (): Step<{ teamId: string }, { team: GuardTeam }> =>
  asStep<{ teamId: string }, { team: GuardTeam }>(async (ctx, next) => {
    const team = await getItem<{ teamId?: string }>(teamPk(ctx.teamId), teamMetaSk());
    if (team === undefined) throw new Error('team_not_found');
    return next({ ...ctx, team: { teamId: ctx.teamId } });
  });

/**
 * Loads the caller's roster row and attaches `member`.
 *
 * @returns A step that throws `not_a_member` when the caller is not on the team.
 */
export const requireMembership = (): Step<
  { teamId: string; user: AuthUser },
  { member: GuardMember }
> =>
  asStep<{ teamId: string; user: AuthUser }, { member: GuardMember }>(async (ctx, next) => {
    const member = await getItem<GuardMember>(
      teamPk(ctx.teamId),
      teamMemberSk(ctx.user.userId),
    );
    if (member === undefined || typeof member.role !== 'string') {
      throw new Error('not_a_member');
    }
    return next({ ...ctx, member });
  });
