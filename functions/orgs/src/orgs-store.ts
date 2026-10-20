/**
 * Organizations: create, administer, add and remove teams, and announce.
 *
 * Rows:
 * - `ORG#<orgId>` / `META` — name and owner.
 * - `ORG#<orgId>` / `ADMIN#<userId>` — admins; the owner is one.
 * - `ORG#<orgId>` / `TEAM#<teamId>` — teams, `pending` until the team accepts.
 * - `TEAM#<teamId>` / `ORG` — the team's organization, read by the membership guard.
 * - `TEAM#<teamId>` / `ORGINVITE#<orgId>` — an invitation the team can see.
 * - `USER#<userId>` / `ORG#<orgId>` — organizations a user administers.
 *
 * A team joins only when someone who manages its billing accepts, because it
 * hands the organization's admins `team_admin` rights over the team.
 */

import { randomUUID } from 'node:crypto';
import { effectivePlanTier, PLAN_LIMITS } from '@gameplan/rules';
import { MAX_ORG_ADMINS, MAX_ORG_TEAMS, type OrgDetail, type OrgSummary, type TeamOrgStatus } from '@gameplan/schemas';
import { findProfileByEmail, getProfile } from '../../lib/auth/index.js';
import { loadMemberNames } from '../../lib/chat-member-names.js';
import {
  ORG_ADMIN_SK_PREFIX,
  ORG_TEAM_SK_PREFIX,
  TABLE_PK,
  TABLE_SK,
  TEAM_MEMBER_SK_PREFIX,
  TEAM_ORG_INVITE_SK_PREFIX,
  USER_ORG_SK_PREFIX,
  deleteItem,
  getItem,
  orgAdminSk,
  orgMetaSk,
  orgPk,
  orgTeamSk,
  putItem,
  queryBySkPrefix,
  teamMetaSk,
  teamOrgInviteSk,
  teamOrgSk,
  teamPk,
  transactWrite,
  userOrgSk,
  userPk,
} from '../../lib/dynamo/index.js';
import { loadTeamPlan } from '../../lib/entitlements.js';
import { TABLE_NAME } from '../../lib/names.js';
import { extraTeamsFor, syncOrgSeats } from '../../lib/org-seats.js';
import {
  clearOrgPlanFromTeam,
  copyOrgPlanToTeam,
  isOrgAdmin,
  orgIdOfTeam,
  orgPlan,
  type OrgTeamItem,
} from '../../lib/orgs.js';
import { sendMessage } from '../../chat/src/chat-store.js';

/** `ORG#<orgId>` / `META`. */
type OrgMetaItem = { orgId: string; name: string; ownerId: string; createdAt: string };

/** Team metadata the organization screens show. */
type TeamMetaItem = { teamId: string; name: string; sport?: string; defaultChatId?: string };

/** Wraps an item as a transaction `Put`. */
const put = (item: Record<string, unknown>) => ({ Put: { TableName: TABLE_NAME, Item: item } });

/** Wraps a key as a transaction `Delete`. */
const del = (pk: string, sk: string) => ({ Delete: { TableName: TABLE_NAME, Key: { [TABLE_PK]: pk, [TABLE_SK]: sk } } });

/**
 * Loads an organization.
 *
 * @param orgId - The organization.
 * @returns Its row.
 * @throws `org_not_found`.
 */
const requireOrg = async (orgId: string): Promise<OrgMetaItem> => {
  const org = await getItem<OrgMetaItem>(orgPk(orgId), orgMetaSk());
  if (org === undefined) throw new Error('org_not_found');
  return org;
};

/**
 * Requires the caller to administer the organization.
 *
 * @param orgId - The organization.
 * @param userId - The caller.
 * @returns The organization.
 * @throws `org_not_found`, or `forbidden` for a non-admin.
 */
export const requireOrgAdmin = async (orgId: string, userId: string): Promise<OrgMetaItem> => {
  const org = await requireOrg(orgId);
  if (!(await isOrgAdmin(orgId, userId))) throw new Error('forbidden');
  return org;
};

/**
 * Requires the caller to own the organization.
 *
 * @param orgId - The organization.
 * @param userId - The caller.
 * @returns The organization.
 */
const requireOrgOwner = async (orgId: string, userId: string): Promise<OrgMetaItem> => {
  const org = await requireOrg(orgId);
  if (org.ownerId !== userId) throw new Error('forbidden');
  return org;
};

/** Every team row, joined or invited. */
const orgTeams = async (orgId: string): Promise<OrgTeamItem[]> =>
  queryBySkPrefix<OrgTeamItem>(orgPk(orgId), ORG_TEAM_SK_PREFIX);

/**
 * The list entry for one organization.
 *
 * @param org - The organization row.
 * @param userId - The viewer.
 * @returns The summary.
 */
const summaryOf = async (org: OrgMetaItem, userId: string): Promise<OrgSummary> => {
  const [teams, plan] = await Promise.all([orgTeams(org.orgId), orgPlan(org.orgId)]);
  return {
    orgId: org.orgId,
    name: org.name,
    ownerId: org.ownerId,
    isOwner: org.ownerId === userId,
    teamCount: teams.filter((team) => !team.pending).length,
    plan,
  };
};

/**
 * Creates an organization with the caller as owner and first admin.
 *
 * @param input - The caller and the name.
 * @returns The new organization.
 * @throws `minor_cannot_own_organization`.
 */
export const createOrg = async (input: { userId: string; name: string }): Promise<OrgSummary> => {
  const profile = await getProfile(input.userId);
  if (profile?.accountKind !== 'adult') throw new Error('minor_cannot_own_organization');
  const org: OrgMetaItem = { orgId: randomUUID(), name: input.name, ownerId: input.userId, createdAt: new Date().toISOString() };
  await transactWrite([
    put({ [TABLE_PK]: orgPk(org.orgId), [TABLE_SK]: orgMetaSk(), ...org }),
    put({ [TABLE_PK]: orgPk(org.orgId), [TABLE_SK]: orgAdminSk(input.userId), orgId: org.orgId, userId: input.userId }),
    put({ [TABLE_PK]: userPk(input.userId), [TABLE_SK]: userOrgSk(org.orgId), orgId: org.orgId }),
  ]);
  return summaryOf(org, input.userId);
};

/**
 * Organizations the caller administers.
 *
 * @param userId - The caller.
 * @returns Summaries, by name.
 */
export const listMyOrgs = async (userId: string): Promise<OrgSummary[]> => {
  const rows = await queryBySkPrefix<{ orgId?: string }>(userPk(userId), USER_ORG_SK_PREFIX);
  const orgs = await Promise.all(
    rows.flatMap((row) => (row.orgId === undefined ? [] : [getItem<OrgMetaItem>(orgPk(row.orgId), orgMetaSk())])),
  );
  const summaries = await Promise.all(
    orgs.filter((org): org is OrgMetaItem => org !== undefined).map((org) => summaryOf(org, userId)),
  );
  return summaries.sort((left, right) => left.name.localeCompare(right.name));
};

/**
 * Everything an admin sees about one organization.
 *
 * @param orgId - The organization.
 * @param userId - The caller, who must be an admin.
 * @returns Admins, teams with member counts, plan, and extra teams.
 */
export const orgDetail = async (orgId: string, userId: string): Promise<OrgDetail> => {
  const org = await requireOrgAdmin(orgId, userId);
  const [summary, adminRows, teamRows] = await Promise.all([
    summaryOf(org, userId),
    queryBySkPrefix<{ userId: string }>(orgPk(orgId), ORG_ADMIN_SK_PREFIX),
    orgTeams(orgId),
  ]);
  const names = await loadMemberNames(adminRows.map((row) => row.userId));
  const teams = await Promise.all(
    teamRows.map(async (row) => {
      const [meta, members] = await Promise.all([
        getItem<TeamMetaItem>(teamPk(row.teamId), teamMetaSk()),
        queryBySkPrefix(teamPk(row.teamId), TEAM_MEMBER_SK_PREFIX),
      ]);
      return {
        teamId: row.teamId,
        name: meta?.name ?? row.teamId,
        ...(meta?.sport !== undefined ? { sport: meta.sport } : {}),
        memberCount: members.length,
        pending: row.pending,
      };
    }),
  );
  return {
    ...summary,
    admins: adminRows.map((row) => ({ userId: row.userId, displayName: names[row.userId] ?? 'Player' })),
    teams: teams.sort((left, right) => left.name.localeCompare(right.name)),
    extraTeams: extraTeamsFor(summary.teamCount),
  };
};

/**
 * Renames an organization.
 *
 * @param input - The organization, caller, and new name.
 * @returns The summary.
 */
export const renameOrg = async (input: { orgId: string; userId: string; name: string }): Promise<OrgSummary> => {
  const org = await requireOrgAdmin(input.orgId, input.userId);
  const next = { ...org, name: input.name };
  await putItem({ [TABLE_PK]: orgPk(org.orgId), [TABLE_SK]: orgMetaSk(), ...next });
  return summaryOf(next, input.userId);
};

/**
 * Adds an admin by the exact email of an existing adult account. Owner only.
 *
 * @param input - The organization, owner, and email.
 * @throws `user_not_found`, `org_admin_must_be_adult`, or `too_many_admins`.
 */
export const addOrgAdmin = async (input: { orgId: string; userId: string; email: string }): Promise<void> => {
  await requireOrgOwner(input.orgId, input.userId);
  const profile = await findProfileByEmail(input.email.toLowerCase());
  if (profile === undefined) throw new Error('user_not_found');
  if (profile.accountKind !== 'adult') throw new Error('org_admin_must_be_adult');
  const admins = await queryBySkPrefix(orgPk(input.orgId), ORG_ADMIN_SK_PREFIX);
  if (admins.length >= MAX_ORG_ADMINS) throw new Error('too_many_admins');
  await transactWrite([
    put({ [TABLE_PK]: orgPk(input.orgId), [TABLE_SK]: orgAdminSk(profile.userId), orgId: input.orgId, userId: profile.userId }),
    put({ [TABLE_PK]: userPk(profile.userId), [TABLE_SK]: userOrgSk(input.orgId), orgId: input.orgId }),
  ]);
};

/**
 * Removes an admin. The owner removes anyone but themselves; an admin may remove themselves.
 *
 * @param input - The organization, caller, and the admin to remove.
 * @throws `owner_cannot_leave` or `forbidden`.
 */
export const removeOrgAdmin = async (input: { orgId: string; userId: string; adminId: string }): Promise<void> => {
  const org = await requireOrgAdmin(input.orgId, input.userId);
  if (input.adminId === org.ownerId) throw new Error('owner_cannot_leave');
  if (input.userId !== org.ownerId && input.userId !== input.adminId) throw new Error('forbidden');
  await transactWrite([del(orgPk(input.orgId), orgAdminSk(input.adminId)), del(userPk(input.adminId), userOrgSk(input.orgId))]);
};

/**
 * Invites a team to join. The team's billing manager accepts.
 *
 * @param input - The organization, admin, and team.
 * @throws `team_not_found`, `team_in_another_organization`, `already_in_organization`, or `too_many_teams`.
 */
export const inviteTeam = async (input: { orgId: string; userId: string; teamId: string }): Promise<void> => {
  await requireOrgAdmin(input.orgId, input.userId);
  const team = await getItem<TeamMetaItem>(teamPk(input.teamId), teamMetaSk());
  if (team === undefined) throw new Error('team_not_found');
  const current = await orgIdOfTeam(input.teamId);
  if (current === input.orgId) throw new Error('already_in_organization');
  if (current !== undefined) throw new Error('team_in_another_organization');
  if ((await orgTeams(input.orgId)).length >= MAX_ORG_TEAMS) throw new Error('too_many_teams');
  const addedAt = new Date().toISOString();
  await transactWrite([
    put({ [TABLE_PK]: orgPk(input.orgId), [TABLE_SK]: orgTeamSk(input.teamId), orgId: input.orgId, teamId: input.teamId, pending: true, addedAt }),
    put({ [TABLE_PK]: teamPk(input.teamId), [TABLE_SK]: teamOrgInviteSk(input.orgId), orgId: input.orgId, teamId: input.teamId, addedAt }),
  ]);
};

/**
 * A team's organization and the invitations waiting for it.
 *
 * @param teamId - The team.
 * @returns Its organization, if any, and invitations by name.
 */
export const teamOrgStatus = async (teamId: string): Promise<TeamOrgStatus> => {
  const [orgId, invites] = await Promise.all([
    orgIdOfTeam(teamId),
    queryBySkPrefix<{ orgId: string }>(teamPk(teamId), TEAM_ORG_INVITE_SK_PREFIX),
  ]);
  const named = async (id: string) => {
    const org = await getItem<OrgMetaItem>(orgPk(id), orgMetaSk());
    return org === undefined ? undefined : { orgId: id, name: org.name };
  };
  const [org, ...invited] = await Promise.all([orgId === undefined ? undefined : named(orgId), ...invites.map((row) => named(row.orgId))]);
  return {
    ...(org !== undefined ? { org } : {}),
    invites: invited.filter((entry): entry is { orgId: string; name: string } => entry !== undefined),
  };
};

/**
 * Joins a team to the organization that invited it. The route checks the
 * caller manages the team's billing.
 *
 * A team paying for its own plan must cancel it first, so nobody pays twice.
 *
 * @param input - The organization and team.
 * @throws `invite_not_found`, `team_in_another_organization`, or `cancel_team_plan_first`.
 */
export const acceptOrgInvite = async (input: { orgId: string; teamId: string }): Promise<void> => {
  const invite = await getItem(teamPk(input.teamId), teamOrgInviteSk(input.orgId));
  if (invite === undefined) throw new Error('invite_not_found');
  if ((await orgIdOfTeam(input.teamId)) !== undefined) throw new Error('team_in_another_organization');
  const plan = await loadTeamPlan(input.teamId);
  if (plan.orgId === undefined && effectivePlanTier(plan) !== 'free') throw new Error('cancel_team_plan_first');
  const addedAt = new Date().toISOString();
  await transactWrite([
    put({ [TABLE_PK]: orgPk(input.orgId), [TABLE_SK]: orgTeamSk(input.teamId), orgId: input.orgId, teamId: input.teamId, pending: false, addedAt }),
    put({ [TABLE_PK]: teamPk(input.teamId), [TABLE_SK]: teamOrgSk(), orgId: input.orgId, teamId: input.teamId, joinedAt: addedAt }),
    del(teamPk(input.teamId), teamOrgInviteSk(input.orgId)),
  ]);
  await copyOrgPlanToTeam(input.orgId, input.teamId);
  await syncOrgSeats(input.orgId);
};

/**
 * Turns down an invitation.
 *
 * @param input - The organization and team.
 */
export const declineOrgInvite = async (input: { orgId: string; teamId: string }): Promise<void> => {
  const row = await getItem<OrgTeamItem>(orgPk(input.orgId), orgTeamSk(input.teamId));
  await deleteItem(teamPk(input.teamId), teamOrgInviteSk(input.orgId));
  if (row?.pending === true) await deleteItem(orgPk(input.orgId), orgTeamSk(input.teamId));
};

/**
 * Takes a team out of the organization, or withdraws its invitation. The
 * team goes back to the free plan.
 *
 * @param input - The organization and team. The route checks who may.
 */
export const removeOrgTeam = async (input: { orgId: string; teamId: string }): Promise<void> => {
  const row = await getItem<OrgTeamItem>(orgPk(input.orgId), orgTeamSk(input.teamId));
  if (row === undefined) throw new Error('team_not_found');
  await transactWrite([
    del(orgPk(input.orgId), orgTeamSk(input.teamId)),
    row.pending ? del(teamPk(input.teamId), teamOrgInviteSk(input.orgId)) : del(teamPk(input.teamId), teamOrgSk()),
  ]);
  if (!row.pending) {
    await clearOrgPlanFromTeam(input.orgId, input.teamId);
    await syncOrgSeats(input.orgId);
  }
};

/**
 * Posts one message to each chosen team's main chat. Needs the organization plan.
 *
 * @param input - The organization, admin, text, and optional teams.
 * @returns How many teams it reached.
 * @throws `plan_required` when the organization is not on the organization plan.
 */
export const announce = async (input: {
  orgId: string;
  userId: string;
  body: string;
  teamIds?: readonly string[];
}): Promise<{ sent: number }> => {
  const org = await requireOrgAdmin(input.orgId, input.userId);
  if (!PLAN_LIMITS[effectivePlanTier(await orgPlan(input.orgId))].orgFeatures) throw new Error('plan_required');
  const members = (await orgTeams(input.orgId)).filter((row) => !row.pending).map((row) => row.teamId);
  const chosen = input.teamIds === undefined ? members : members.filter((id) => input.teamIds?.includes(id));
  let sent = 0;
  for (const teamId of chosen) {
    const team = await getItem<TeamMetaItem>(teamPk(teamId), teamMetaSk());
    if (team?.defaultChatId === undefined) continue;
    await sendMessage({
      chatId: team.defaultChatId,
      userId: input.userId,
      body: { body: `${org.name}: ${input.body}` },
      authorizedOutsideChat: true,
    });
    sent += 1;
  }
  return { sent };
};

/**
 * Whether the caller may take a team out: an organization admin, or the team's
 * billing manager (checked by the route).
 *
 * @param orgId - The organization.
 * @param userId - The caller.
 * @returns `true` for an organization admin.
 */
export const callerAdministersOrg = (orgId: string, userId: string): Promise<boolean> => isOrgAdmin(orgId, userId);
