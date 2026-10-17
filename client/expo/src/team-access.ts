/**
 * The caller's roles and permissions on a team.
 *
 * Every screen that hides controls the caller cannot use reads permissions here,
 * so they share one request per team and the same multi-role check as the API.
 */

import { useQuery } from '@tanstack/react-query';
import { canWithRoles, permissionMatrix, rolesFromMembership } from '@gameplan/rules';
import type { RolePermissions, TeamPermission, TeamRole } from '@gameplan/types';
import { permissionsQuery } from './queries/teams';
import { useApp } from './state';

export type TeamAccess = {
  /** Roles the caller holds, highest rank first. */
  roles: TeamRole[];
  /** The team's role-permission rows once loaded. */
  rows: RolePermissions[] | undefined;
  /** True once the rows loaded or failed. Until then {@link TeamAccess.can} is `false`. */
  ready: boolean;
  /** Whether any held role grants the permission. */
  can: (permission: TeamPermission) => boolean;
};

/**
 * The caller's access on a team.
 *
 * @param team - A membership payload for the caller, such as a team summary.
 * @returns Held roles and a permission check.
 */
export const useTeamAccess = (
  team: { teamId: string; role?: TeamRole; roles?: readonly TeamRole[] } | undefined,
): TeamAccess => {
  const { api } = useApp();
  const teamId = team?.teamId;
  const { data: rows, isError } = useQuery({
    ...permissionsQuery(api, teamId ?? ''),
    enabled: teamId !== undefined,
  });
  const roles = team === undefined ? [] : rolesFromMembership(team);
  const matrix = permissionMatrix(rows ?? []);
  return {
    roles,
    rows,
    ready: teamId !== undefined && (rows !== undefined || isError),
    can: (permission) => canWithRoles(roles, matrix, permission),
  };
};
