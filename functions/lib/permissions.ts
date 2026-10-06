/**
 * Team permission checks.
 *
 * Privileged actions call {@link can}, which reads the caller's membership and
 * the team's role-permission rows. That shared read is the stand-in for a
 * second backend process.
 */

import type { TeamPermission, TeamRole } from '@gameplan/types';
import { DEFAULT_ROLE_PERMISSIONS } from '@gameplan/types';
import { getItem, queryBySkPrefix } from './dynamo/access.js';
import { ROLE_PERMISSIONS_SK_PREFIX, teamMemberSk, teamPk } from './dynamo/keys.js';

/** DynamoDB shape of a roster membership under `TEAM#<id>` / `MEMBER#<userId>`. */
type TeamMemberItem = {
  role?: unknown;
};

/** DynamoDB shape of a role-permission row under `TEAM#<id>` / `ROLE#<role>`. */
type RolePermissionsItem = {
  role?: unknown;
  permissions?: unknown;
};

/**
 * Returns whether a role's permission list includes the given permission.
 *
 * @param permissions - Permissions granted to the role.
 * @param permission - The permission under test.
 * @returns `true` when the list contains the permission.
 */
export const roleHasPermission = (
  permissions: readonly TeamPermission[],
  permission: TeamPermission,
): boolean => permissions.includes(permission);

/**
 * Pure permission check when membership and the matrix are already loaded.
 *
 * @param role - The caller's role on the team.
 * @param matrix - Permissions keyed by role.
 * @param permission - The permission under test.
 * @returns `true` when the role grants the permission.
 */
export const canWithMatrix = (
  role: TeamRole,
  matrix: Readonly<Partial<Record<TeamRole, readonly TeamPermission[]>>>,
  permission: TeamPermission,
): boolean => roleHasPermission(matrix[role] ?? [], permission);

/**
 * Ensures `manage_permissions` stays on `team_admin` and is never granted to a
 * role held by a minor (callers pass the account kind separately).
 *
 * @param role - The role whose permissions are being saved.
 * @param permissions - The proposed permission list.
 * @returns A normalized list, or throws when the admin bootstrap rule is broken.
 */
export const normalizeRolePermissions = (
  role: TeamRole,
  permissions: readonly TeamPermission[],
): TeamPermission[] => {
  const unique = [...new Set(permissions)];
  if (role === 'team_admin' && !unique.includes('manage_permissions')) {
    throw new Error('manage_permissions_required_for_team_admin');
  }
  return unique;
};

/**
 * Loads the role-permission matrix for a team from DynamoDB.
 *
 * Falls back to {@link DEFAULT_ROLE_PERMISSIONS} for any role that has no row
 * yet (for example, a brand-new team mid-write).
 *
 * @param teamId - The team whose matrix should be loaded.
 * @returns Permissions keyed by role.
 */
export const loadRolePermissionMatrix = async (
  teamId: string,
): Promise<Record<TeamRole, TeamPermission[]>> => {
  const items = await queryBySkPrefix<RolePermissionsItem>(
    teamPk(teamId),
    ROLE_PERMISSIONS_SK_PREFIX,
  );
  const matrix: Record<TeamRole, TeamPermission[]> = {
    team_admin: [...DEFAULT_ROLE_PERMISSIONS.team_admin],
    coach: [...DEFAULT_ROLE_PERMISSIONS.coach],
    parent: [...DEFAULT_ROLE_PERMISSIONS.parent],
    player: [...DEFAULT_ROLE_PERMISSIONS.player],
  };

  for (const item of items) {
    if (typeof item.role !== 'string') continue;
    const role = item.role as TeamRole;
    if (!(role in matrix)) continue;
    if (!Array.isArray(item.permissions)) continue;
    matrix[role] = item.permissions.filter(
      (value): value is TeamPermission => typeof value === 'string',
    );
  }

  return matrix;
};

/**
 * Returns whether a user holds a team permission.
 *
 * Reads the roster membership and the team's role-permission matrix from
 * DynamoDB. Missing membership means the caller cannot act.
 *
 * @param userId - The Cognito `sub` of the caller.
 * @param teamId - The team under test.
 * @param permission - The privileged permission under test.
 * @returns `true` when the caller's role grants the permission.
 */
export const can = async (
  userId: string,
  teamId: string,
  permission: TeamPermission,
): Promise<boolean> => {
  const member = await getItem<TeamMemberItem>(teamPk(teamId), teamMemberSk(userId));
  if (member === undefined || typeof member.role !== 'string') return false;
  const role = member.role as TeamRole;
  const matrix = await loadRolePermissionMatrix(teamId);
  return canWithMatrix(role, matrix, permission);
};
