/**
 * Account rules for minors, and the minor chat membership rule.
 *
 * These are not team permissions. The admin screen cannot turn them off.
 */

import type { AccountKind } from '@gameplan/types';

/** Age at which an account is treated as an adult. */
const ADULT_AGE_YEARS = 18;

/** ISO calendar date pattern (`YYYY-MM-DD`). */
const BIRTHDAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

/** A chat participant with the fields the minor rule needs. */
export type ChatParticipant = {
  /** Cognito `sub`. */
  userId: string;
  /** Adult or minor. */
  accountKind: AccountKind;
  /** Team ids the person belongs to. */
  teamIds: readonly string[];
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
 * Returns whether two team-id lists share at least one team.
 *
 * @param left - Team ids for the first person.
 * @param right - Team ids for the second person.
 * @returns `true` when the intersection is non-empty.
 */
export const sharesTeam = (
  left: readonly string[],
  right: readonly string[],
): boolean => {
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
 * Returns whether a proposed chat membership set satisfies the minor rule.
 *
 * A minor cannot be in a chat with someone who shares none of that minor's
 * teams. That covers the default team chat, team-visible channels, and private
 * chats. When every member is an adult, the set is always allowed.
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
 * Rejects adding an outsider to a chat that already has a minor, or adding a
 * minor to a chat that already has an outsider.
 *
 * @param existing - Current chat members.
 * @param adding - The person being added.
 * @returns `true` when the addition is allowed under the minor rule.
 */
export const canAddChatMember = (
  existing: readonly ChatParticipant[],
  adding: ChatParticipant,
): boolean => isMinorChatMembershipAllowed([...existing, adding]);
