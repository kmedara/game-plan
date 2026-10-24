/**
 * Names copied onto team roster rows, so a roster read can search people by
 * name without loading each profile.
 *
 * Joining a team copies the names from the profile. A profile name change
 * rewrites them on every team the user is on. Rows written before names were
 * copied get them the first time a teammate search reads them.
 */

import {
  USER_TEAM_SK_PREFIX,
  getItem,
  profileSk,
  queryBySkPrefix,
  teamMemberSk,
  teamPk,
  updateFields,
  userPk,
} from './dynamo/index.js';

/** Name attributes stored on a `TEAM#id` / `MEMBER#userId` row. */
export type RosterNames = {
  displayName: string;
  firstName?: string;
  lastName?: string;
};

/**
 * Reads the name attributes from a profile or roster row.
 *
 * @param row - A profile or roster row.
 * @returns The names, or `undefined` when the row has no display name.
 */
export const rosterNames = (
  row: { displayName?: unknown; firstName?: unknown; lastName?: unknown } | undefined,
): RosterNames | undefined => {
  if (typeof row?.displayName !== 'string' || row.displayName.length === 0) return undefined;
  return {
    displayName: row.displayName,
    ...(typeof row.firstName === 'string' ? { firstName: row.firstName } : {}),
    ...(typeof row.lastName === 'string' ? { lastName: row.lastName } : {}),
  };
};

/**
 * Attribute spread for a roster row write.
 *
 * @param names - Names to store, when known.
 * @returns The name attributes, or an empty object.
 */
export const rosterNameFields = (names: RosterNames | undefined): RosterNames | Record<string, never> =>
  names ?? {};

/**
 * Loads the names to copy onto a user's roster rows.
 *
 * @param userId - The member.
 * @returns Names from their profile, or `undefined` when the profile is gone.
 */
export const loadRosterNames = async (userId: string): Promise<RosterNames | undefined> =>
  rosterNames(await getItem<Record<string, unknown>>(userPk(userId), profileSk()));

/**
 * Sets the names on one roster row and nothing else, so a role or position
 * change made at the same time is kept. A first or last name the profile no
 * longer has is removed.
 *
 * @param teamId - The team.
 * @param userId - The member.
 * @param names - The names to store.
 * @returns `false` when the member is no longer on the team.
 */
export const writeRosterNames = async (
  teamId: string,
  userId: string,
  names: RosterNames,
): Promise<boolean> => {
  try {
    await updateFields(teamPk(teamId), teamMemberSk(userId), {
      displayName: names.displayName,
      firstName: names.firstName,
      lastName: names.lastName,
    });
    return true;
  } catch (error) {
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') return false;
    throw error;
  }
};

/**
 * Puts a user's new names on their roster row in every team they are on.
 *
 * @param userId - The renamed user.
 * @param names - Their new names.
 */
export const renameRosterMember = async (userId: string, names: RosterNames): Promise<void> => {
  const teams = await queryBySkPrefix<{ teamId?: unknown }>(userPk(userId), USER_TEAM_SK_PREFIX);
  for (const team of teams) {
    if (typeof team.teamId === 'string') await writeRosterNames(team.teamId, userId, names);
  }
};
