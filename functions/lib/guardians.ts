/**
 * Guardian links between an adult account and a minor account.
 */

import { randomUUID } from 'node:crypto';
import { rolesFromMembership } from '@gameplan/rules';
import { findProfileByEmail, getProfile } from './auth/index.js';
import {
  GUARDIAN_SK_PREFIX,
  TABLE_PK,
  TABLE_SK,
  USER_TEAM_SK_PREFIX,
  childSk,
  deleteItem,
  getItem,
  guardianInviteSk,
  guardianSk,
  putItem,
  queryBySkPrefix,
  teamMemberSk,
  teamPk,
  userPk,
} from './dynamo/index.js';

/** Pending invite stored on both the minor and the invited adult. */
export type GuardianInvite = {
  inviteId: string;
  minorId: string;
  adultId: string;
  email: string;
};

/** Confirmed link. */
export type GuardianLink = {
  minorId: string;
  adultId: string;
};

type InviteItem = GuardianInvite & { PK: string; SK: string };

type UserTeamItem = { teamId?: string };

type TeamMemberItem = { role?: unknown; roles?: unknown };

/**
 * Lists adult user ids linked to a minor.
 *
 * @param minorId - The minor's user id.
 * @returns Guardian user ids.
 */
export const listGuardianIds = async (minorId: string): Promise<string[]> => {
  const rows = await queryBySkPrefix<{ adultId?: string }>(userPk(minorId), GUARDIAN_SK_PREFIX);
  return rows
    .map((row) => row.adultId)
    .filter((id): id is string => typeof id === 'string');
};

/**
 * Creates a pending invite from a minor to an adult email.
 *
 * @param minorId - The signed-in minor.
 * @param email - The guardian's email.
 * @returns The pending invite.
 */
export const createGuardianInvite = async (
  minorId: string,
  email: string,
): Promise<GuardianInvite> => {
  const minor = await getProfile(minorId);
  if (minor === undefined) throw new Error('profile_not_found');
  if (minor.accountKind !== 'minor') throw new Error('guardian_invite_minor_only');

  const adult = await findProfileByEmail(email.trim().toLowerCase());
  if (adult === undefined) throw new Error('guardian_not_found');
  if (adult.accountKind !== 'adult' || adult.userId === minorId) {
    throw new Error('guardian_must_be_adult');
  }

  const existing = await listGuardianIds(minorId);
  if (existing.includes(adult.userId)) throw new Error('guardian_already_linked');

  const invite: InviteItem = {
    [TABLE_PK]: userPk(adult.userId),
    [TABLE_SK]: guardianInviteSk('pending'),
    inviteId: randomUUID(),
    minorId,
    adultId: adult.userId,
    email: adult.email,
  };
  invite.SK = guardianInviteSk(invite.inviteId);
  await putItem(invite);
  await putItem({ ...invite, [TABLE_PK]: userPk(minorId) });
  return {
    inviteId: invite.inviteId,
    minorId,
    adultId: adult.userId,
    email: adult.email,
  };
};

/**
 * Confirms an invite when the caller is the invited adult.
 *
 * @param inviteId - The invite id.
 * @param adultId - The signed-in adult.
 * @returns The stored link.
 */
export const acceptGuardianInvite = async (
  inviteId: string,
  adultId: string,
): Promise<GuardianLink> => {
  const invite = await getItem<InviteItem>(userPk(adultId), guardianInviteSk(inviteId));
  if (invite === undefined || invite.adultId !== adultId) throw new Error('guardian_invite_not_found');

  await putItem({
    [TABLE_PK]: userPk(invite.minorId),
    [TABLE_SK]: guardianSk(invite.adultId),
    minorId: invite.minorId,
    adultId: invite.adultId,
  });
  await putItem({
    [TABLE_PK]: userPk(invite.adultId),
    [TABLE_SK]: childSk(invite.minorId),
    minorId: invite.minorId,
    adultId: invite.adultId,
  });
  await deleteItem(userPk(invite.adultId), guardianInviteSk(inviteId));
  await deleteItem(userPk(invite.minorId), guardianInviteSk(inviteId));
  return { minorId: invite.minorId, adultId: invite.adultId };
};

/**
 * Resolves which side of a link each id is on.
 *
 * @param leftId - One user id.
 * @param rightId - The other user id.
 * @returns The pair when a link exists.
 */
const linkedPair = async (
  leftId: string,
  rightId: string,
): Promise<GuardianLink | undefined> => {
  const leftIsMinor = await getItem(userPk(leftId), guardianSk(rightId));
  if (leftIsMinor !== undefined) return { minorId: leftId, adultId: rightId };
  const rightIsMinor = await getItem(userPk(rightId), guardianSk(leftId));
  if (rightIsMinor !== undefined) return { minorId: rightId, adultId: leftId };
  return undefined;
};

/**
 * Returns whether the caller is team admin of a team both people belong to.
 *
 * @param callerId - The signed-in user.
 * @param otherUserId - The other user.
 * @returns `true` when the caller administers a shared team.
 */
const callerIsSharedTeamAdmin = async (callerId: string, otherUserId: string): Promise<boolean> => {
  const callerTeams = await queryBySkPrefix<UserTeamItem>(userPk(callerId), USER_TEAM_SK_PREFIX);
  const otherTeams = new Set(
    (await queryBySkPrefix<UserTeamItem>(userPk(otherUserId), USER_TEAM_SK_PREFIX))
      .map((row) => row.teamId)
      .filter((id): id is string => typeof id === 'string'),
  );
  for (const row of callerTeams) {
    if (row.teamId === undefined || !otherTeams.has(row.teamId)) continue;
    const membership = await getItem<TeamMemberItem>(teamPk(row.teamId), teamMemberSk(callerId));
    if (membership !== undefined && rolesFromMembership(membership).includes('team_admin')) return true;
  }
  return false;
};

/**
 * Removes the link between the caller and `:userId`, or a minor's only link
 * when a shared team admin asks.
 *
 * @param callerId - The signed-in user.
 * @param otherUserId - The other person, or the minor when an admin removes a link.
 */
export const removeGuardianLink = async (callerId: string, otherUserId: string): Promise<void> => {
  const direct = await linkedPair(callerId, otherUserId);
  if (direct !== undefined) {
    await deleteItem(userPk(direct.minorId), guardianSk(direct.adultId));
    await deleteItem(userPk(direct.adultId), childSk(direct.minorId));
    return;
  }
  if (!(await callerIsSharedTeamAdmin(callerId, otherUserId))) throw new Error('forbidden');
  const guardians = await listGuardianIds(otherUserId);
  if (guardians.length !== 1) throw new Error('guardian_not_linked');
  const adultId = guardians[0];
  if (adultId === undefined) throw new Error('guardian_not_linked');
  await deleteItem(userPk(otherUserId), guardianSk(adultId));
  await deleteItem(userPk(adultId), childSk(otherUserId));
};
