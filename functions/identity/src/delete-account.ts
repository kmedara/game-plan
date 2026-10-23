/**
 * Deletes a person's account and the personal data that belongs only to them.
 *
 * What goes: the profile, medical info, settings, devices, calendar feed,
 * the person's copy of their dues, every roster and chat membership, guardian
 * links on both sides, organization admin seats, the profile photo, and the
 * sign-in account.
 *
 * What stays with the team: messages they sent, past RSVPs, and the team's own
 * dues ledger. Those belong to the team's record as much as to the person.
 * A free team outside any organization with nobody else on it is deleted
 * outright (see `delete-team.ts`).
 *
 * A person who holds something others depend on must hand it over first: an
 * organization they own, or a team where they are the only admin and someone
 * else is still on the roster or the team pays for its own plan.
 */

import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { effectivePlanTier, rolesFromMembership } from '@gameplan/rules';
import { getIdentityProvider } from '../../lib/auth/index.js';
import { refreshChatMemberNames } from '../../lib/chat-member-names.js';
import {
  TABLE_SK,
  TEAM_MEMBER_SK_PREFIX,
  chatMemberSk,
  chatPk,
  childSk,
  deleteItem,
  feedMetaSk,
  feedPk,
  getItem,
  guardianSk,
  orgAdminSk,
  orgMetaSk,
  orgPk,
  queryBySkPrefix,
  queryPartition,
  teamMemberSk,
  teamMetaSk,
  teamPk,
  userPk,
} from '../../lib/dynamo/index.js';
import { loadTeamPlan } from '../../lib/entitlements.js';
import { deleteTeam, isLeftEmpty } from './delete-team.js';

/** Something the person must resolve before the account can go. */
export type DeletionBlockers = {
  /** Organizations the person owns. */
  ownedOrgs: string[];
  /** Teams where the person is the only admin and the team still needs one. */
  soleAdminTeams: string[];
};

type UserRow = {
  [TABLE_SK]: string;
  teamId?: string;
  chatId?: string;
  kind?: string;
  orgId?: string;
  adultId?: string;
  minorId?: string;
  token?: string;
  photoKey?: string;
  role?: unknown;
  roles?: unknown;
};

type MemberRow = { userId?: string; role?: unknown; roles?: unknown };

const rowsOf = (rows: UserRow[], prefix: string): UserRow[] =>
  rows.filter((row) => row[TABLE_SK].startsWith(prefix));

/**
 * Whether a team still needs this person as its admin.
 *
 * @param teamId - A team the person administers.
 * @param userId - The person.
 * @returns `true` when nobody else is an admin and the roster or the bill still needs one.
 */
const needsThisAdmin = async (teamId: string, userId: string): Promise<boolean> => {
  const members = await queryBySkPrefix<MemberRow>(teamPk(teamId), TEAM_MEMBER_SK_PREFIX);
  const others = members.filter((member) => member.userId !== userId);
  if (others.some((member) => rolesFromMembership(member).includes('team_admin'))) return false;
  if (others.length > 0) return true;
  const plan = await loadTeamPlan(teamId);
  return plan.orgId === undefined && effectivePlanTier(plan) !== 'free';
};

/**
 * Lists what keeps an account from being deleted right now.
 *
 * @param userId - The person.
 * @returns Names of owned organizations and of teams that need this admin.
 */
export const deletionBlockers = async (userId: string): Promise<DeletionBlockers> => {
  const rows = await queryPartition<UserRow>(userPk(userId));

  const ownedOrgs: string[] = [];
  for (const row of rowsOf(rows, 'ORG#')) {
    if (row.orgId === undefined) continue;
    const org = await getItem<{ name?: string; ownerId?: string }>(orgPk(row.orgId), orgMetaSk());
    if (org?.ownerId === userId) ownedOrgs.push(org.name ?? row.orgId);
  }

  const soleAdminTeams: string[] = [];
  for (const row of rowsOf(rows, 'TEAM#')) {
    if (row.teamId === undefined || !rolesFromMembership(row).includes('team_admin')) continue;
    if (!(await needsThisAdmin(row.teamId, userId))) continue;
    const team = await getItem<{ name?: string }>(teamPk(row.teamId), teamMetaSk());
    soleAdminTeams.push(team?.name ?? row.teamId);
  }

  return { ownedOrgs, soleAdminTeams };
};

/**
 * Whether there is anything to resolve first.
 *
 * @param blockers - From {@link deletionBlockers}.
 * @returns `true` when the account cannot be deleted yet.
 */
export const isBlocked = (blockers: DeletionBlockers): boolean =>
  blockers.ownedOrgs.length > 0 || blockers.soleAdminTeams.length > 0;

let s3: S3Client | undefined;

/**
 * Deletes the profile photo. Other uploads stay: they are team logos and chat files.
 *
 * @param key - The photo's object key.
 */
const deletePhoto = async (key: string): Promise<void> => {
  const bucket = process.env.MEDIA_BUCKET;
  if (bucket === undefined || bucket === '') return;
  s3 ??= new S3Client({});
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
};

/**
 * Deletes the account. Call {@link deletionBlockers} first.
 *
 * Each step deletes by key, so a retry after a failure part-way finishes the job.
 * The sign-in account goes last, so a failure never leaves data nobody can reach.
 *
 * @param userId - The person.
 */
export const deleteAccount = async (userId: string): Promise<void> => {
  const pk = userPk(userId);
  const rows = await queryPartition<UserRow>(pk);

  const chatRows = rowsOf(rows, 'CHAT#');
  for (const row of rowsOf(rows, 'TEAM#')) {
    const teamId = row.teamId;
    if (teamId === undefined) continue;
    if (await isLeftEmpty(teamId, userId)) {
      const teamChats = chatRows
        .filter((chat) => chat.teamId === teamId && chat.kind !== 'fixture' && chat.chatId !== undefined)
        .map((chat) => chat.chatId as string);
      await deleteTeam(teamId, teamChats);
    } else {
      await deleteItem(teamPk(teamId), teamMemberSk(userId));
    }
  }

  for (const row of chatRows) {
    if (row.chatId === undefined) continue;
    await deleteItem(chatPk(row.chatId), chatMemberSk(userId));
    if (row.kind === 'private') await refreshChatMemberNames(row.chatId);
  }

  for (const row of rowsOf(rows, 'GUARDIAN#')) {
    if (row.adultId !== undefined) await deleteItem(userPk(row.adultId), childSk(userId));
  }
  for (const row of rowsOf(rows, 'CHILD#')) {
    if (row.minorId !== undefined) await deleteItem(userPk(row.minorId), guardianSk(userId));
  }
  for (const row of rowsOf(rows, 'GUARDIAN_INVITE#')) {
    const other = row.adultId === userId ? row.minorId : row.adultId;
    if (other !== undefined) await deleteItem(userPk(other), row[TABLE_SK]);
  }

  for (const row of rowsOf(rows, 'ORG#')) {
    if (row.orgId !== undefined) await deleteItem(orgPk(row.orgId), orgAdminSk(userId));
  }

  const feed = rows.find((row) => row[TABLE_SK] === 'FEED');
  if (feed?.token !== undefined) await deleteItem(feedPk(feed.token), feedMetaSk());

  const photoKey = rows.find((row) => row[TABLE_SK] === 'PROFILE')?.photoKey;
  if (photoKey !== undefined) await deletePhoto(photoKey);

  for (const row of rows) await deleteItem(pk, row[TABLE_SK]);

  await getIdentityProvider().deleteUser(userId);
};
