/**
 * HTTP route guards shared by every area Lambda.
 */

import type { AuthUser, TeamPermission, TeamRole } from '@gameplan/types';
import { highestRole, rolesFromMembership } from '@gameplan/rules';
import { authenticateRequest } from './auth/cognito.js';
import { getItem } from './dynamo/access.js';
import { teamMemberSk, teamMetaSk, teamPk } from './dynamo/keys.js';
import { canWithRoles } from '@gameplan/rules';
import { administersTeamOrg } from './orgs.js';
import { loadRolePermissionMatrix } from './permissions.js';
import { asStep, type Step } from './pipeline.js';

/** Team identity confirmed by {@link requireTeam}. */
export type GuardTeam = {
  teamId: string;
};

/** Roster membership loaded by {@link requireMembership}. */
export type GuardMember = {
  userId: string;
  /** Highest-ranked role. Rank checks use this. */
  role: TeamRole;
  /** Every role this member holds, highest rank first. */
  roles: TeamRole[];
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
 * List after {@link requireMembership}. The roles come from the `member` it
 * attached, so this step only loads the team's permission matrix.
 *
 * @param permission - The required permission.
 * @returns A step that throws `forbidden` when the permission is missing.
 */
export const requirePermission = (
  permission: TeamPermission,
): Step<{ teamId: string; member: GuardMember }, object> =>
  asStep<{ teamId: string; member: GuardMember }, object>(async (ctx, next) => {
    const matrix = await loadRolePermissionMatrix(ctx.teamId);
    if (!canWithRoles(ctx.member.roles, matrix, permission)) throw new Error('forbidden');
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
 * An admin of the organization the team belongs to counts as `team_admin`
 * there without being on the roster. That check runs only when the caller has
 * no roster row, so members pay nothing extra.
 *
 * @returns A step that throws `not_a_member` when the caller is not on the team.
 */
export const requireMembership = (): Step<
  { teamId: string; user: AuthUser },
  { member: GuardMember }
> =>
  asStep<{ teamId: string; user: AuthUser }, { member: GuardMember }>(async (ctx, next) => {
    const member = await getItem<{ userId?: unknown; role?: unknown; roles?: unknown }>(
      teamPk(ctx.teamId),
      teamMemberSk(ctx.user.userId),
    );
    const roles = member === undefined ? [] : rolesFromMembership(member);
    if (roles.length === 0) {
      if (!(await administersTeamOrg(ctx.teamId, ctx.user.userId))) throw new Error('not_a_member');
      return next({ ...ctx, member: { userId: ctx.user.userId, role: 'team_admin', roles: ['team_admin'] } });
    }
    return next({
      ...ctx,
      member: {
        userId: typeof member?.userId === 'string' ? member.userId : ctx.user.userId,
        role: highestRole(roles),
        roles,
      },
    });
  });
