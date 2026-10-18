/**
 * Chat list sections: one header per team, then private chats.
 */

import type { ChatSummary } from '@gameplan/types';

const kindRank = (kind: ChatSummary['kind']): number =>
  kind === 'default' ? 0 : kind === 'channel' ? 1 : 2;

/** Fixture threads have no single team, so they sit with private chats. */
const isLooseChat = (kind: ChatSummary['kind']): boolean => kind === 'private' || kind === 'fixture';

/**
 * Groups team chats under the membership they belong to.
 *
 * Private chats are not a team's chat, so they stay in their own list. Team
 * sections follow the membership order. Within a team, the default chat comes
 * before channels.
 *
 * @param teams - The athlete's teams, in list order.
 * @param chats - Every chat the athlete can see.
 * @returns A section per team, plus the private chats.
 */
export const groupChatsByTeam = <T extends { teamId: string }>(
  teams: readonly T[],
  chats: readonly ChatSummary[],
): { sections: { team: T; chats: ChatSummary[] }[]; privateChats: ChatSummary[] } => ({
  sections: teams.map((team) => ({
    team,
    chats: chats
      .filter((chat) => !isLooseChat(chat.kind) && chat.teamId === team.teamId)
      .sort((left, right) => kindRank(left.kind) - kindRank(right.kind) || left.name.localeCompare(right.name)),
  })),
  privateChats: chats
    .filter((chat) => isLooseChat(chat.kind))
    .sort((left, right) => left.name.localeCompare(right.name)),
});
