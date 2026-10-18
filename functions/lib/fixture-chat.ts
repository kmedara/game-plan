/**
 * Staff thread for a shared fixture.
 *
 * Schedule creates the chat. Teams refreshes membership when roles change.
 * Both areas write the same chat rows through this helper.
 */

import { canWithRoles, rolesFromMembership } from '@gameplan/rules';
import { loadRolePermissionMatrix } from './permissions.js';
import {
  FIXTURE_LINK_SK_PREFIX,
  TABLE_PK,
  TABLE_SK,
  TEAM_MEMBER_SK_PREFIX,
  chatMetaSk,
  chatPk,
  deleteItem,
  fixtureMetaSk,
  fixturePk,
  getItem,
  putItem,
  queryBySkPrefix,
  teamMemberSk,
  teamPk,
} from './dynamo/index.js';
import { listChatMemberIds, removeChatMember, syncChatMembers } from './chat-membership.js';

/** Link row under `TEAM#id` / `FIXTURE#fixtureId`. */
type FixtureLinkRow = {
  fixtureId?: string;
  chatId?: string;
  status?: string;
};

/** Fixture metadata needed to rebuild the staff thread. */
type FixtureChatSource = {
  fixtureId?: string;
  status?: string;
  chatId?: string;
  homeName?: string;
  awayName?: string;
  homeTeamId?: string;
  awayTeamId?: string;
  createdBy?: string;
};

/**
 * Requires `manage_events` on the caller's roles for this team.
 *
 * @param teamId - The team the caller must be allowed to schedule.
 * @param userId - The caller.
 */
export const assertCanManageEvents = async (teamId: string, userId: string): Promise<void> => {
  const member = await getItem<{ role?: unknown; roles?: unknown }>(teamPk(teamId), teamMemberSk(userId));
  const roles = member === undefined ? [] : rolesFromMembership(member);
  if (roles.length === 0) throw new Error('not_a_member');
  const matrix = await loadRolePermissionMatrix(teamId);
  if (!canWithRoles(roles, matrix, 'manage_events')) throw new Error('forbidden');
};

/**
 * Members whose roles include `manage_events`.
 *
 * @param teamId - The team id.
 * @returns User ids who may share a game and post in the fixture thread.
 */
export const eventManagerIds = async (teamId: string): Promise<string[]> => {
  const matrix = await loadRolePermissionMatrix(teamId);
  const rows = await queryBySkPrefix<{ userId?: string; role?: unknown; roles?: unknown }>(
    teamPk(teamId),
    TEAM_MEMBER_SK_PREFIX,
  );
  return rows.flatMap((row) => {
    if (typeof row.userId !== 'string') return [];
    const roles = rolesFromMembership(row);
    return canWithRoles(roles, matrix, 'manage_events') ? [row.userId] : [];
  });
};

/**
 * Chat title from the two club names, capped at the chat name limit.
 *
 * @param homeName - The home club.
 * @param awayName - The away club.
 * @returns A name of at most 100 characters.
 */
export const fixtureChatName = (homeName: string, awayName: string): string => {
  const name = `${homeName} vs ${awayName}`;
  return name.length <= 100 ? name : name.slice(0, 100);
};

/**
 * Makes the fixture thread's members match the given staff.
 *
 * @param input - Chat id, title, creator, and the staff who belong in it.
 */
export const syncFixtureChat = async (input: {
  chatId: string;
  name: string;
  createdBy: string;
  memberIds: readonly string[];
}): Promise<void> => {
  const createdAt = new Date().toISOString();
  const meta = await getItem<Record<string, unknown>>(chatPk(input.chatId), chatMetaSk());
  if (meta === undefined) {
    await putItem({
      [TABLE_PK]: chatPk(input.chatId),
      [TABLE_SK]: chatMetaSk(),
      chatId: input.chatId,
      kind: 'fixture',
      name: input.name,
      createdBy: input.createdBy,
      createdAt,
    });
  } else if (meta.name !== input.name) {
    await putItem({ ...meta, name: input.name });
  }
  await syncChatMembers({ chatId: input.chatId, kind: 'fixture', name: input.name }, input.memberIds, createdAt);
};

/**
 * Removes the fixture thread's membership. Messages stay on the chat partition.
 *
 * @param chatId - The thread to close.
 */
export const dissolveFixtureChat = async (chatId: string): Promise<void> => {
  for (const userId of await listChatMemberIds(chatId)) await removeChatMember(chatId, userId);
  await deleteItem(chatPk(chatId), chatMetaSk());
};

/**
 * Rewrites one linked fixture's thread from the current staff of both clubs.
 *
 * @param source - Fixture metadata that already has a chat.
 */
export const refreshFixtureChat = async (source: FixtureChatSource): Promise<void> => {
  if (source.status !== 'linked' || source.chatId === undefined) return;
  if (source.homeTeamId === undefined || source.awayTeamId === undefined) return;
  const memberIds = [
    ...new Set([
      ...(await eventManagerIds(source.homeTeamId)),
      ...(await eventManagerIds(source.awayTeamId)),
    ]),
  ];
  await syncFixtureChat({
    chatId: source.chatId,
    name: fixtureChatName(source.homeName ?? 'Home', source.awayName ?? 'Away'),
    createdBy: source.createdBy ?? memberIds[0] ?? source.chatId,
    memberIds,
  });
};

/**
 * Refreshes every linked fixture thread this team belongs to.
 *
 * Called after a role change so a new coach joins and a former coach leaves.
 *
 * @param teamId - The team whose roster changed.
 */
export const refreshTeamFixtureChats = async (teamId: string): Promise<void> => {
  const links = await queryBySkPrefix<FixtureLinkRow>(teamPk(teamId), FIXTURE_LINK_SK_PREFIX);
  for (const link of links) {
    if (link.chatId === undefined || link.fixtureId === undefined) continue;
    const meta = await getItem<FixtureChatSource>(fixturePk(link.fixtureId), fixtureMetaSk());
    if (meta === undefined) continue;
    await refreshFixtureChat(meta);
  }
};
