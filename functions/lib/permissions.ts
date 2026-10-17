/**
 * Team permission checks.
 *
 * Privileged routes load the caller's roles with `requireMembership`, then
 * `requirePermission` checks them against the team's role-permission matrix
 * from {@link loadRolePermissionMatrix}. The check itself (`canWithRoles`)
 * lives in `@gameplan/rules` so the app uses the same definition.
 */

import type { TeamPermission, TeamRole } from "@gameplan/types";
import { DEFAULT_ROLE_PERMISSIONS } from "@gameplan/types";
import { queryBySkPrefix } from "./dynamo/access.js";
import { ROLE_PERMISSIONS_SK_PREFIX, teamPk } from "./dynamo/keys.js";

/** DynamoDB shape of a role-permission row under `TEAM#<id>` / `ROLE#<role>`. */
type RolePermissionsItem = {
  role?: unknown;
  permissions?: unknown;
};

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
  if (role === "team_admin" && !unique.includes("manage_permissions")) {
    throw new Error("manage_permissions_required_for_team_admin");
  }
  return unique;
};

/**
 * Loads the role-permission matrix for a team from DynamoDB.
 *
 * Falls back to {@link DEFAULT_ROLE_PERMISSIONS} for any role that has no row
 * yet (for example, a brand-new team mid-write). `team_admin` always receives
 * the default list, so a newly added permission applies without rewriting the
 * stored admin row.
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
    if (typeof item.role !== "string") continue;
    const role = item.role as TeamRole;
    if (!(role in matrix) || role === "team_admin") continue;
    if (!Array.isArray(item.permissions)) continue;
    matrix[role] = item.permissions.filter(
      (value): value is TeamPermission => typeof value === "string",
    );
  }

  return matrix;
};
