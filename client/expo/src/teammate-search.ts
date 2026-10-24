/**
 * Teammate suggestions for starting a private chat.
 */

import { matchesPersonName } from '@gameplan/rules';
import type { AutocompleteChoice } from './ui';

/** Most suggestions shown at once. */
const TEAMMATE_LIMIT = 50;

/** One team's roster, minus the caller. */
export type TeammateGroup = {
  team: { teamId: string; name: string };
  members: { userId: string; displayName?: string; accountKind?: 'adult' | 'minor'; hasGuardian?: boolean }[];
};

/**
 * Joins a team and member into one choice id.
 *
 * @param teamId - The roster the member was picked from.
 * @param userId - The member.
 * @returns An id that {@link parseTeammateChoiceId} reads back.
 */
export const teammateChoiceId = (teamId: string, userId: string): string => `${teamId}\n${userId}`;

/**
 * Splits a choice id from {@link teammateChoiceId}.
 *
 * @param id - The picked choice id.
 * @returns The team and member ids.
 */
export const parseTeammateChoiceId = (id: string): { teamId: string; userId: string } => {
  const [teamId = '', userId = ''] = id.split('\n');
  return { teamId, userId };
};

/**
 * Teammates whose name matches the query, sorted by name.
 *
 * The query must start a word of the name, as on the server search, so `lo`
 * finds Ada Lovelace but `ace` does not.
 *
 * A chat is started from one team, so once someone is picked only their
 * team's roster is offered. People already picked are left out. When the
 * caller is an adult, a minor with no linked guardian is listed but cannot be
 * picked, since the server would refuse that chat.
 *
 * @param input - Rosters, the current picks, the typed query, and display options.
 * @returns Choices labeled with the name, plus the team when several are listed.
 */
export const searchTeammates = (input: {
  groups: readonly TeammateGroup[];
  pickedTeamId: string | undefined;
  pickedIds: readonly string[];
  query: string;
  showTeam: boolean;
  unknownName: string;
  callerIsAdult: boolean;
  noGuardianReason: string;
}): AutocompleteChoice[] => {
  return input.groups
    .filter((group) => input.pickedTeamId === undefined || group.team.teamId === input.pickedTeamId)
    .flatMap((group) =>
      group.members
        .filter((member) => !input.pickedIds.includes(member.userId))
        .map((member) => ({ group, member, name: member.displayName ?? input.unknownName })),
    )
    .filter((row) => matchesPersonName(input.query, { displayName: row.name }))
    .sort((left, right) => left.name.localeCompare(right.name) || left.group.team.name.localeCompare(right.group.team.name))
    .slice(0, TEAMMATE_LIMIT)
    .map((row) => ({
      id: teammateChoiceId(row.group.team.teamId, row.member.userId),
      label: input.showTeam ? `${row.name} · ${row.group.team.name}` : row.name,
      ...(input.callerIsAdult && row.member.accountKind === 'minor' && row.member.hasGuardian === false
        ? { disabledReason: input.noGuardianReason }
        : {}),
    }));
};
