/**
 * Deletes a team that the last person on it is leaving.
 *
 * Only a team with nobody else on its roster, outside any organization, and on
 * the free plan goes: a paid team still has a subscription to manage, and an
 * organization's admins still look after its teams.
 *
 * Reminder rows are left to their sweeps, which drop a row whose team or charge
 * is gone. Uploaded chat files stay in the bucket under their uploader's prefix.
 */

import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { effectivePlanTier } from '@gameplan/rules';
import {
  TABLE_SK,
  TEAM_MEMBER_SK_PREFIX,
  chatPk,
  deleteItem,
  getItem,
  inviteMetaSk,
  invitePk,
  orgPk,
  orgTeamSk,
  queryBySkPrefix,
  queryPartition,
  stripeAccountPk,
  stripeAccountSk,
  stripeCustomerPk,
  teamDirectoryPk,
  teamDirectorySk,
  teamMetaSk,
  teamOrgSk,
  teamPk,
} from '../../lib/dynamo/index.js';
import { loadTeamPlan } from '../../lib/entitlements.js';
import { releaseTeamFixtures } from '../../lib/fixture-release.js';

type TeamRow = {
  [TABLE_SK]: string;
  name?: string;
  defaultChatId?: string;
  theme?: { logoKey?: string };
  code?: string;
  orgId?: string;
  accountId?: string;
  customerId?: string;
};

/**
 * Whether a team should be deleted when this person leaves it.
 *
 * @param teamId - A team the person is on.
 * @param userId - The person leaving.
 * @returns `true` when nobody else is on it, it is in no organization, and it is free.
 */
export const isLeftEmpty = async (teamId: string, userId: string): Promise<boolean> => {
  const members = await queryBySkPrefix<{ userId?: string }>(teamPk(teamId), TEAM_MEMBER_SK_PREFIX);
  if (members.some((member) => member.userId !== userId)) return false;
  if ((await getItem(teamPk(teamId), teamOrgSk())) !== undefined) return false;
  return effectivePlanTier(await loadTeamPlan(teamId)) === 'free';
};

let s3: S3Client | undefined;

const deleteUpload = async (key: string): Promise<void> => {
  const bucket = process.env.MEDIA_BUCKET;
  if (bucket === undefined || bucket === '') return;
  s3 ??= new S3Client({});
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
};

/** Deletes every row of a chat: members and messages. */
const deleteChat = async (chatId: string): Promise<void> => {
  const pk = chatPk(chatId);
  for (const row of await queryPartition<{ [TABLE_SK]: string }>(pk)) await deleteItem(pk, row[TABLE_SK]);
};

/**
 * Deletes a team and everything that points at it.
 *
 * Each step deletes by key, so a retry finishes the job. The team partition
 * goes last, since the earlier steps read it.
 *
 * @param teamId - The team, already checked with {@link isLeftEmpty}.
 * @param chatIds - The team's chats besides its default one (channels, rides),
 *   from the leaving person's chat list. Shared fixture threads are not included.
 */
export const deleteTeam = async (teamId: string, chatIds: readonly string[]): Promise<void> => {
  const pk = teamPk(teamId);
  const rows = await queryPartition<TeamRow>(pk);
  const meta = rows.find((row) => row[TABLE_SK] === teamMetaSk());

  await releaseTeamFixtures(teamId);

  for (const chatId of new Set([...(meta?.defaultChatId === undefined ? [] : [meta.defaultChatId]), ...chatIds])) {
    await deleteChat(chatId);
  }

  if (meta?.name !== undefined) await deleteItem(teamDirectoryPk(), teamDirectorySk(meta.name, teamId));
  for (const row of rows) {
    const sk = row[TABLE_SK];
    if (sk.startsWith('INVITE#') && row.code !== undefined) await deleteItem(invitePk(row.code), inviteMetaSk());
    if (sk.startsWith('ORGINVITE#') && row.orgId !== undefined) await deleteItem(orgPk(row.orgId), orgTeamSk(teamId));
    if (sk === 'STRIPE' && row.accountId !== undefined) {
      await deleteItem(stripeAccountPk(row.accountId), stripeAccountSk());
    }
    if (sk === 'BILLING' && row.customerId !== undefined) await deleteItem(stripeCustomerPk(row.customerId), 'TEAM');
  }

  const logoKey = meta?.theme?.logoKey;
  if (logoKey !== undefined) await deleteUpload(logoKey);

  for (const row of rows) await deleteItem(pk, row[TABLE_SK]);
};
