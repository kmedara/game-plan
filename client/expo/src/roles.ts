/**
 * Shared role labels and invite-code parsing.
 */

import type { TeamPermission, TeamRole } from '@gameplan/types';

/** Translation keys for team roles on invite controls. */
const ROLE_LABEL_KEYS: Record<TeamRole, string> = {
  team_admin: 'role.team_admin',
  coach: 'role.coach',
  player: 'role.player',
  parent: 'role.parent',
};

/**
 * Translation key for a team role, or the raw role when unknown.
 *
 * @param role - The stored role.
 * @returns A catalog key such as `role.team_admin`.
 */
export const roleLabel = (role: string): string =>
  role in ROLE_LABEL_KEYS ? ROLE_LABEL_KEYS[role as TeamRole] : role;

/**
 * Roles on a membership payload.
 *
 * Falls back to the single `role` when `roles` is absent.
 *
 * @param member - A roster row or team summary.
 * @returns The held roles.
 */
export const heldRoles = (member: { role: TeamRole; roles?: readonly TeamRole[] }): TeamRole[] =>
  member.roles !== undefined && member.roles.length > 0 ? [...member.roles] : [member.role];

/**
 * True when any held role grants the permission.
 *
 * @param roles - Roles the member holds.
 * @param matrix - The team's role-permission rows.
 * @param permission - The permission under test.
 * @returns Whether the set grants it.
 */
export const memberHasPermission = (
  roles: readonly TeamRole[],
  matrix: readonly { role: TeamRole; permissions: readonly TeamPermission[] }[],
  permission: TeamPermission,
): boolean =>
  matrix.some((row) => roles.includes(row.role) && row.permissions.includes(permission));

/**
 * Reads an invite code from a pasted link or a bare code.
 *
 * @param raw - Text from the invite-code field or a shared URL.
 * @returns The code, or an empty string when the input is blank.
 */
export const inviteCodeFromInput = (raw: string): string => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return '';
  try {
    const url = new URL(trimmed, 'http://local');
    const parts = url.pathname.split('/').filter((part) => part.length > 0);
    const index = parts.lastIndexOf('invite');
    const code = index >= 0 ? parts[index + 1] : undefined;
    if (code !== undefined && code.length > 0) return decodeURIComponent(code);
  } catch {
    // The text is a code, not a URL.
  }
  return trimmed;
};

/**
 * Maps join-request API errors to translation keys.
 *
 * @param err - The error thrown by the API client.
 * @returns A catalog key.
 */
export const joinRequestMessage = (err: unknown): string => {
  const code = err instanceof Error ? err.message : '';
  if (code === 'minor_cannot_be_team_admin') return 'errors.join.minorCannotBeTeamAdmin';
  if (code === 'minor_cannot_hold_manage_permissions') return 'errors.join.minorCannotManagePermissions';
  if (code === 'already_a_member') return 'errors.join.alreadyMember';
  if (code === 'join_request_not_found' || code === 'not_found') return 'errors.join.notPending';
  return 'errors.join.updateFailed';
};

/**
 * Sentence key for a failed invite lookup or accept.
 *
 * @param err - The error from the API client.
 * @returns A catalog key.
 */
export const inviteErrorMessage = (err: unknown): string => {
  const code = err instanceof Error ? err.message : '';
  switch (code) {
    case 'not_found':
      return 'errors.invite.notValid';
    case 'already_a_member':
      return 'errors.invite.alreadyMember';
    case 'minor_cannot_be_team_admin':
    case 'minor_cannot_hold_manage_permissions':
      return 'errors.invite.roleUnavailable';
    case 'forbidden':
      return 'errors.invite.cannotUse';
    default:
      return 'errors.invite.failed';
  }
};
