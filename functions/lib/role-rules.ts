/**
 * Team role checks that need a profile or the permission matrix from the database.
 *
 * Rank and account checks live in `@gameplan/rules`. These helpers load the
 * rows, then call those shared functions.
 */

import type { TeamPermission, TeamRole } from '@gameplan/types';
import { TEAM_ROLES } from '@gameplan/types';
import {
  assertRoleAllowedForAccount,
  canCreateTeam,
  canHoldManagePermissions,
  rolesFromMembership,
} from '@gameplan/rules';
import { getProfile } from './auth/profile.js';
import { queryBySkPrefix } from './dynamo/access.js';
import { TEAM_MEMBER_SK_PREFIX, teamPk } from './dynamo/keys.js';
import { loadRolePermissionMatrix, normalizeRolePermissions } from './permissions.js';

/**
 * Rejects team creation when the caller is missing or is a minor.
 *
 * @param userId - The caller's user id.
 */
export const assertCanCreateTeam = async (userId: string): Promise<void> => {
  const profile = await getProfile(userId);
  if (profile === undefined) throw new Error('profile_not_found');
  if (!canCreateTeam(profile.accountKind)) throw new Error('minor_cannot_create_team');
};

/**
 * Rejects a role when the target account cannot hold it on this team.
 *
 * @param userId - The user who would hold the role.
 * @param teamId - The team id.
 * @param role - The proposed role.
 */
export const assertAccountMayHoldRole = async (
  userId: string,
  teamId: string,
  role: TeamRole,
): Promise<void> => {
  const profile = await getProfile(userId);
  if (profile === undefined) throw new Error('profile_not_found');
  const matrix = await loadRolePermissionMatrix(teamId);
  assertRoleAllowedForAccount(profile.accountKind, role, matrix);
};

/**
 * Rejects a permission matrix that would give `manage_permissions` to a minor.
 *
 * Members with no profile are skipped. The admin screen cannot grant that
 * permission through a role a minor already holds.
 *
 * @param teamId - The team id.
 * @param roles - Proposed permissions keyed by role.
 */
export const assertProposedRolePermissions = async (
  teamId: string,
  roles: Array<{ role: TeamRole; permissions: readonly TeamPermission[] }>,
): Promise<void> => {
  const members = await queryBySkPrefix<{ userId?: string; role?: unknown; roles?: unknown }>(
    teamPk(teamId),
    TEAM_MEMBER_SK_PREFIX,
  );
  const next = await loadRolePermissionMatrix(teamId);
  for (const entry of roles) {
    next[entry.role] = normalizeRolePermissions(entry.role, entry.permissions);
  }

  for (const role of TEAM_ROLES) {
    if (!next[role].includes('manage_permissions')) continue;
    for (const member of members) {
      if (!rolesFromMembership(member).includes(role) || typeof member.userId !== 'string') continue;
      const profile = await getProfile(member.userId);
      if (profile === undefined) continue;
      if (!canHoldManagePermissions(profile.accountKind)) {
        throw new Error('minor_cannot_hold_manage_permissions');
      }
    }
  }
};
