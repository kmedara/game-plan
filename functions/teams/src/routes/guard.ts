/**
 * Teams route steps that load a team or membership onto the pipeline context.
 */

import type { AuthUser } from '@gameplan/types';
import { asStep, type Step } from '../../../lib/pipeline.js';
import {
  requireMembership as loadMembership,
  requireTeam as loadTeam,
  type TeamMemberItem,
  type TeamMetaItem,
} from '../team-store.js';

/**
 * Loads the team named by `teamId` and attaches `team`.
 *
 * @returns A step that throws `team_not_found` when the team does not exist.
 */
export const requireTeam = (): Step<{ teamId: string }, { team: TeamMetaItem }> =>
  asStep<{ teamId: string }, { team: TeamMetaItem }>(async (ctx, next) =>
    next({ ...ctx, team: await loadTeam(ctx.teamId) }),
  );

/**
 * Loads the caller's roster row and attaches `member`.
 *
 * @returns A step that throws `not_a_member` when the caller is not on the team.
 */
export const requireMembership = (): Step<
  { teamId: string; user: AuthUser },
  { member: TeamMemberItem }
> =>
  asStep<{ teamId: string; user: AuthUser }, { member: TeamMemberItem }>(async (ctx, next) =>
    next({ ...ctx, member: await loadMembership(ctx.teamId, ctx.user.userId) }),
  );
