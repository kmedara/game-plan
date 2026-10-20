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
 * screen is reachable. Coaches start able to read emergency info, since they
 * are the ones at practice; parent and player start with no privileged
 * permissions.
 */
export const DEFAULT_ROLE_PERMISSIONS: Readonly<
  Record<TeamRole, readonly TeamPermission[]>
> = {
  team_admin: TEAM_PERMISSIONS,
  coach: ['view_medical_info'],
  parent: [],
  player: [],
};

export { TEAM_PERMISSIONS, TEAM_ROLES };
