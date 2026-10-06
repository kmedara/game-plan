/**
 * Domain constants derived from enumeration literals.
 */

import {
  TEAM_PERMISSIONS,
  TEAM_ROLES,
  type TeamPermission,
  type TeamRole,
} from './enums.js';

/**
 * Default role-permission matrix when a team is created.
 *
 * The creating adult is `team_admin` and holds every permission so the admin
 * screen is reachable. Coach, parent, and player start with none of the
 * privileged permissions.
 */
export const DEFAULT_ROLE_PERMISSIONS: Readonly<
  Record<TeamRole, readonly TeamPermission[]>
> = {
  team_admin: TEAM_PERMISSIONS,
  coach: [],
  parent: [],
  player: [],
};

export { TEAM_PERMISSIONS, TEAM_ROLES };
