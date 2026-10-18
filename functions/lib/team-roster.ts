/**
 * Who is on a team, for areas that only need the ids.
 */

import { TEAM_MEMBER_SK_PREFIX, queryBySkPrefix, teamPk } from './dynamo/index.js';

/**
 * User ids on a team's roster.
 *
 * @param teamId - The team.
 * @returns Member user ids. Rows without a usable id are skipped.
 */
export const listTeamMemberIds = async (teamId: string): Promise<string[]> => {
  const rows = await queryBySkPrefix<{ userId?: unknown }>(teamPk(teamId), TEAM_MEMBER_SK_PREFIX);
  return rows.flatMap((row) => (typeof row.userId === 'string' ? [row.userId] : []));
};
