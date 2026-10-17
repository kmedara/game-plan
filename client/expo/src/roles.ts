/**
 * Shared role labels, invite-code parsing, and team error messages.
 */

import { rolesFromMembership } from '@gameplan/rules';
import type { TeamRole } from '@gameplan/types';
import { errorMessageKey } from './errors';

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
 * Translated, comma-separated roles for a membership payload.
 *
 * @param member - A roster row or team summary.
 * @param t - The translate function.
 * @returns Text such as `Coach, Parent`.
 */
export const roleNames = (
  member: { role?: TeamRole; roles?: readonly TeamRole[] },
  t: (key: string) => string,
): string =>
  rolesFromMembership(member)
    .map((role) => t(roleLabel(role)))
    .join(', ');

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
export const joinRequestMessage = (err: unknown): string =>
  errorMessageKey(err, 'errors.join.updateFailed', {
    already_a_member: 'errors.join.alreadyMember',
    join_request_not_found: 'errors.join.notPending',
    not_found: 'errors.join.notPending',
  });

/**
 * Sentence key for a failed invite lookup or accept.
 *
 * @param err - The error from the API client.
 * @returns A catalog key.
 */
export const inviteErrorMessage = (err: unknown): string =>
  errorMessageKey(err, 'errors.invite.failed', {
    not_found: 'errors.invite.notValid',
    already_a_member: 'errors.invite.alreadyMember',
    minor_cannot_be_team_admin: 'errors.invite.roleUnavailable',
    minor_cannot_hold_manage_permissions: 'errors.invite.roleUnavailable',
    forbidden: 'errors.invite.cannotUse',
  });
