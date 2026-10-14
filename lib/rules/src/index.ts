/**
 * Product rules shared by the API and the app.
 *
 * These functions only look at values the caller already has. Handlers that
 * must read the database call them after that read. The server still enforces
 * every rule; the app uses the same functions to avoid a request that will fail.
 */

import type {
  AccountKind,
  ChatParticipant,
  TeamPermission,
  TeamRole,
  UserSearchPolicy,
} from '@gameplan/types';
import { TEAM_ROLES } from '@gameplan/types';

/** Age at which an account is treated as an adult. */
const ADULT_AGE_YEARS = 18;

/** ISO calendar date pattern (`YYYY-MM-DD`). */
const BIRTHDAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

/** How many distinct positions one member may list. */
export const MAX_POSITIONS = 8;

/** v1 search policy: exact-email lookup returns adults only. */
export const V1_USER_SEARCH_POLICY: UserSearchPolicy = {
  adultsOnly: true,
};

/**
 * Derives adult vs minor from a birthday calendar date.
 *
 * Anyone who has not yet reached their 18th birthday is a minor.
 *
 * @param birthday - ISO date string (`YYYY-MM-DD`).
 * @param now - Clock used for the age check (defaults to the current time).
 * @returns `minor` when under 18, otherwise `adult`.
 */
export const accountKindFromBirthday = (
  birthday: string,
  now: Date = new Date(),
): AccountKind => {
  const match = BIRTHDAY_PATTERN.exec(birthday);
  if (match === null) throw new Error('invalid_birthday');

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const birthUtc = Date.UTC(year, month - 1, day);
  const birth = new Date(birthUtc);
  if (
    Number.isNaN(birthUtc) ||
    birth.getUTCFullYear() !== year ||
    birth.getUTCMonth() !== month - 1 ||
    birth.getUTCDate() !== day
  ) {
    throw new Error('invalid_birthday');
  }

  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (birthUtc > todayUtc) throw new Error('invalid_birthday');

  const eighteenthUtc = Date.UTC(year + ADULT_AGE_YEARS, month - 1, day);
  return todayUtc < eighteenthUtc ? 'minor' : 'adult';
};

/**
 * Resolves adult versus minor for a profile read.
 *
 * The birthday is the stored fact. When it is present, the kind is derived
 * from that date and the current day. A missing or unreadable birthday keeps
 * the stored kind.
 *
 * @param birthday - Calendar date of birth, when the profile has one.
 * @param stored - The kind saved on the profile row.
 * @param now - Clock used for the age check.
 * @returns The kind callers should enforce.
 */
export const accountKindForProfile = (
  birthday: string | undefined,
  stored: AccountKind,
  now: Date = new Date(),
): AccountKind => {
  if (birthday === undefined) return stored;
  try {
    return accountKindFromBirthday(birthday, now);
  } catch {
    return stored;
  }
};

/**
 * Returns whether two team-id lists share at least one team.
 *
 * @param left - Team ids for the first person.
 * @param right - Team ids for the second person.
 * @returns `true` when the intersection is non-empty.
 */
export const sharesTeam = (left: readonly string[], right: readonly string[]): boolean => {
  if (left.length === 0 || right.length === 0) return false;
  const set = new Set(left);
  return right.some((teamId) => set.has(teamId));
};

/**
 * An adult may create a team. A minor may not.
 *
 * @param accountKind - The caller's account kind.
 * @returns `true` when team creation is allowed.
 */
export const canCreateTeam = (accountKind: AccountKind): boolean => accountKind === 'adult';

/**
 * Only an adult may hold the `team_admin` role.
 *
 * @param accountKind - The member's account kind.
 * @returns `true` when the admin role is allowed.
 */
export const canBeTeamAdmin = (accountKind: AccountKind): boolean => accountKind === 'adult';

/**
 * Only an adult may be granted `manage_permissions`.
 *
 * @param accountKind - The member's account kind.
 * @returns `true` when that permission may be assigned through a role they hold.
 */
export const canHoldManagePermissions = (accountKind: AccountKind): boolean =>
  accountKind === 'adult';

/**
 * True when `callerRole` is the same rank or higher than `role`.
 *
 * {@link TEAM_ROLES} is ordered from highest rank to lowest.
 *
 * @param callerRole - The role of the member granting access.
 * @param role - The role being granted.
 * @returns Whether the caller may grant that role.
 */
export const callerCanGrant = (callerRole: TeamRole, role: TeamRole): boolean => {
  const callerRank = TEAM_ROLES.indexOf(callerRole);
  const roleRank = TEAM_ROLES.indexOf(role);
  return callerRank !== -1 && roleRank !== -1 && callerRank <= roleRank;
};

/**
 * Rejects a grant when the caller is below the role they are handing out.
 *
 * @param callerRole - The role of the member granting access.
 * @param role - The role being granted.
 */
export const assertCallerCanGrant = (callerRole: TeamRole, role: TeamRole): void => {
  if (!callerCanGrant(callerRole, role)) throw new Error('role_outranks_caller');
};

/**
 * Returns whether an account may hold a role with the given permissions.
 *
 * @param accountKind - The member's account kind.
 * @param role - The proposed role.
 * @param permissions - Permissions currently attached to that role.
 * @returns `false` when a minor would become admin or hold `manage_permissions`.
 */
export const roleAllowedForAccount = (
  accountKind: AccountKind,
  role: TeamRole,
  permissions: readonly TeamPermission[] = [],
): boolean => {
  if (role === 'team_admin' && !canBeTeamAdmin(accountKind)) return false;
  if (permissions.includes('manage_permissions') && !canHoldManagePermissions(accountKind)) {
    return false;
  }
  return true;
};

/**
 * Rejects assigning a role that a minor account cannot hold.
 *
 * @param accountKind - The member's account kind.
 * @param role - The proposed role.
 * @param matrix - The team's role-permission matrix.
 */
export const assertRoleAllowedForAccount = (
  accountKind: AccountKind,
  role: TeamRole,
  matrix: Readonly<Partial<Record<TeamRole, readonly TeamPermission[]>>>,
): void => {
  const permissions = matrix[role] ?? [];
  if (role === 'team_admin' && !canBeTeamAdmin(accountKind)) {
    throw new Error('minor_cannot_be_team_admin');
  }
  if (permissions.includes('manage_permissions') && !canHoldManagePermissions(accountKind)) {
    throw new Error('minor_cannot_hold_manage_permissions');
  }
};

/**
 * Returns whether a proposed chat membership set satisfies the minor rule.
 *
 * A minor cannot be in a chat with someone who shares none of that minor's
 * teams. When every member is an adult, the set is always allowed.
 *
 * @param members - The full membership after the proposed change.
 * @returns `true` when every minor shares a team with every other member.
 */
export const isMinorChatMembershipAllowed = (members: readonly ChatParticipant[]): boolean => {
  const minors = members.filter((member) => member.accountKind === 'minor');
  if (minors.length === 0) return true;

  for (const minor of minors) {
    for (const other of members) {
      if (other.userId === minor.userId) continue;
      if (!sharesTeam(minor.teamIds, other.teamIds)) return false;
    }
  }
  return true;
};

/**
 * Returns whether adding one person keeps the minor chat rule intact.
 *
 * @param existing - Current chat members.
 * @param adding - The person being added.
 * @returns `true` when the addition is allowed under the minor rule.
 */
export const canAddChatMember = (
  existing: readonly ChatParticipant[],
  adding: ChatParticipant,
): boolean => isMinorChatMembershipAllowed([...existing, adding]);

/**
 * Returns whether a profile may appear in search under the given policy.
 *
 * @param accountKind - The candidate's account kind.
 * @param policy - The search policy. Defaults to {@link V1_USER_SEARCH_POLICY}.
 * @returns `true` when the candidate should be returned to the caller.
 */
export const matchesUserSearchPolicy = (
  accountKind: AccountKind,
  policy: UserSearchPolicy = V1_USER_SEARCH_POLICY,
): boolean => !policy.adultsOnly || accountKind === 'adult';

/**
 * Counts positions after case-insensitive duplicates are collapsed.
 *
 * @param positions - Positions from the form or the request.
 * @returns The number of distinct names.
 */
export const distinctPositionCount = (positions: readonly string[]): number => {
  const seen = new Set<string>();
  for (const position of positions) seen.add(position.toLowerCase());
  return seen.size;
};

/**
 * Returns whether a position list stays within {@link MAX_POSITIONS}.
 *
 * @param positions - Positions from the form or the request.
 * @returns `false` when more than eight distinct names remain.
 */
export const positionsWithinLimit = (positions: readonly string[]): boolean =>
  distinctPositionCount(positions) <= MAX_POSITIONS;

/**
 * Rejects a position list with more than eight distinct names.
 *
 * @param positions - Positions from the request.
 */
export const assertPositionLimit = (positions: readonly string[]): void => {
  if (!positionsWithinLimit(positions)) throw new Error('too_many_positions');
};

/**
 * Returns whether an event end is missing or not before the start.
 *
 * @param startsAt - Series start ISO.
 * @param endsAt - Series end ISO, when set.
 * @returns `false` when the end instant is earlier than the start.
 */
export const eventWindowIsValid = (startsAt: string, endsAt: string | undefined): boolean => {
  if (endsAt === undefined || endsAt.length === 0) return true;
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  return end >= start;
};

/**
 * Rejects an event whose end is before its start.
 *
 * @param startsAt - Series start ISO.
 * @param endsAt - Series end ISO, when set.
 */
export const assertEventEndsAfterStart = (startsAt: string, endsAt: string | undefined): void => {
  if (endsAt === undefined) return;
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime())) throw new Error('invalid_starts_at');
  if (Number.isNaN(end.getTime())) throw new Error('invalid_ends_at');
  if (end.getTime() < start.getTime()) throw new Error('invalid_ends_at');
};
