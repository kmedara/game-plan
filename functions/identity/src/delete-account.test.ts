/**
 * Account deletion: what blocks it, what it removes, and what stays with the team.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryTable } from '../../lib/dynamo/memory-table.js';
import {
  TABLE_PK,
  TABLE_SK,
  chatMemberSk,
  chatMetaSk,
  chatPk,
  childSk,
  eventSk,
  feedMetaSk,
  feedPk,
  fixtureLinkSk,
  fixtureMetaSk,
  fixturePk,
  guardianInviteSk,
  guardianSk,
  inviteMetaSk,
  invitePk,
  messageSk,
  orgAdminSk,
  orgMetaSk,
  orgPk,
  planSk,
  profileSk,
  teamDirectoryPk,
  teamDirectorySk,
  teamMemberSk,
  teamMetaSk,
  teamOrgSk,
  teamPk,
  userChatSk,
  userFeedSk,
  userOrgSk,
  userPk,
  userTeamSk,
} from '../../lib/dynamo/keys.js';

const { deleteUser, s3Send } = vi.hoisted(() => ({
  deleteUser: vi.fn(async (_userId: string): Promise<void> => undefined),
  s3Send: vi.fn(async (_command: unknown): Promise<void> => undefined),
}));

vi.mock('../../lib/dynamo/access.js', async () => (await import('../../lib/dynamo/memory-table.js')).memoryAccess);
vi.mock('../../lib/auth/index.js', () => ({ getIdentityProvider: () => ({ deleteUser }) }));
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = s3Send;
  },
  DeleteObjectCommand: class {
    constructor(readonly input: unknown) {}
  },
}));

const { deleteAccount, deletionBlockers, isBlocked } = await import('./delete-account.js');

const { store, itemKey } = memoryTable;

const put = (pk: string, sk: string, fields: Record<string, unknown> = {}): void => {
  store.set(itemKey(pk, sk), { [TABLE_PK]: pk, [TABLE_SK]: sk, ...fields });
};
const has = (pk: string, sk: string): boolean => store.has(itemKey(pk, sk));

/** Puts a person on a team with its default chat, the same rows a join writes. */
const join = (userId: string, teamId: string, roles: string[], name = teamId): void => {
  if (!has(teamPk(teamId), teamMetaSk())) put(teamPk(teamId), teamMetaSk(), { teamId, name });
  put(teamPk(teamId), teamMemberSk(userId), { userId, role: roles[0], roles });
  put(userPk(userId), userTeamSk(teamId), { teamId, role: roles[0], roles });
  put(chatPk(`${teamId}-chat`), chatMemberSk(userId), { userId });
  put(userPk(userId), userChatSk(`${teamId}-chat`), { chatId: `${teamId}-chat`, kind: 'default', teamId });
};

describe('account deletion', () => {
  beforeEach(() => {
    store.clear();
    deleteUser.mockClear();
    s3Send.mockClear();
    process.env.MEDIA_BUCKET = 'media';
  });

  it('blocks an organization owner and a team that would lose its only admin', async () => {
    put(orgPk('org-1'), orgMetaSk(), { orgId: 'org-1', name: 'Metro FC', ownerId: 'u1' });
    put(userPk('u1'), userOrgSk('org-1'), { orgId: 'org-1' });
    join('u1', 'rockets', ['team_admin'], 'Rockets');
    join('u2', 'rockets', ['player']);

    const blockers = await deletionBlockers('u1');
    expect(blockers).toEqual({ ownedOrgs: ['Metro FC'], soleAdminTeams: ['Rockets'] });
    expect(isBlocked(blockers)).toBe(true);
  });

  it('lets an admin go when another admin stays, or the team is empty and free', async () => {
    join('u1', 'rockets', ['team_admin']);
    join('u2', 'rockets', ['coach', 'team_admin']);
    join('u1', 'solo', ['team_admin']);
    put(orgPk('org-1'), orgMetaSk(), { orgId: 'org-1', name: 'Metro FC', ownerId: 'u9' });
    put(userPk('u1'), userOrgSk('org-1'), { orgId: 'org-1' });

    expect(isBlocked(await deletionBlockers('u1'))).toBe(false);
  });

  it('keeps an empty team that pays for its own plan from losing its admin', async () => {
    join('u1', 'solo', ['team_admin'], 'Solo');
    put(teamPk('solo'), planSk(), { teamId: 'solo', tier: 'premium', status: 'active' });

    expect((await deletionBlockers('u1')).soleAdminTeams).toEqual(['Solo']);
  });

  it('removes the person everywhere and leaves the team its messages', async () => {
    join('u1', 'rockets', ['player']);
    join('u2', 'rockets', ['team_admin']);
    put(userPk('u1'), profileSk(), { userId: 'u1', email: 'u1@example.com', photoKey: 'uploads/u1/photo' });
    put(userPk('u1'), 'MEDICAL', { allergies: 'peanuts' });
    put(userPk('u1'), userFeedSk(), { token: 'feed-token' });
    put(feedPk('feed-token'), feedMetaSk(), { userId: 'u1' });
    put(chatPk('rockets-chat'), messageSk('2026-01-01T00:00:00.000Z', 'm1'), { senderId: 'u1', body: 'hi' });

    // A private chat whose stored names should drop u1.
    put(chatPk('dm'), chatMetaSk(), { chatId: 'dm', kind: 'private', memberNames: { u1: 'Ana', u2: 'Bo' } });
    put(chatPk('dm'), chatMemberSk('u1'), { userId: 'u1' });
    put(chatPk('dm'), chatMemberSk('u2'), { userId: 'u2' });
    put(userPk('u2'), profileSk(), { userId: 'u2', displayName: 'Bo' });
    put(userPk('u1'), userChatSk('dm'), { chatId: 'dm', kind: 'private' });

    // u1 is a guardian of m1, has a pending invite from m2, and admins an org they do not own.
    put(userPk('m1'), guardianSk('u1'), { minorId: 'm1', adultId: 'u1' });
    put(userPk('u1'), childSk('m1'), { minorId: 'm1', adultId: 'u1' });
    put(userPk('m2'), guardianInviteSk('inv'), { inviteId: 'inv', minorId: 'm2', adultId: 'u1' });
    put(userPk('u1'), guardianInviteSk('inv'), { inviteId: 'inv', minorId: 'm2', adultId: 'u1' });
    put(orgPk('org-1'), orgAdminSk('u1'), { orgId: 'org-1', userId: 'u1' });
    put(userPk('u1'), userOrgSk('org-1'), { orgId: 'org-1' });

    await deleteAccount('u1');

    expect([...store.keys()].filter((key) => key.startsWith(`${userPk('u1')}\0`))).toEqual([]);
    expect(has(teamPk('rockets'), teamMemberSk('u1'))).toBe(false);
    expect(has(chatPk('rockets-chat'), chatMemberSk('u1'))).toBe(false);
    expect(has(userPk('m1'), guardianSk('u1'))).toBe(false);
    expect(has(userPk('m2'), guardianInviteSk('inv'))).toBe(false);
    expect(has(orgPk('org-1'), orgAdminSk('u1'))).toBe(false);
    expect(has(feedPk('feed-token'), feedMetaSk())).toBe(false);
    expect(store.get(itemKey(chatPk('dm'), chatMetaSk()))?.memberNames).toEqual({ u2: 'Bo' });

    expect(has(chatPk('rockets-chat'), messageSk('2026-01-01T00:00:00.000Z', 'm1'))).toBe(true);
    expect(has(teamPk('rockets'), teamMemberSk('u2'))).toBe(true);
    expect(s3Send).toHaveBeenCalledWith(
      expect.objectContaining({ input: { Bucket: 'media', Key: 'uploads/u1/photo' } }),
    );
    expect(deleteUser).toHaveBeenCalledWith('u1');
  });

  it('deletes a free team left with nobody on it, and unlinks its shared game', async () => {
    join('u1', 'solo', ['team_admin'], 'Solo');
    put(teamPk('solo'), teamMetaSk(), {
      teamId: 'solo',
      name: 'Solo',
      defaultChatId: 'solo-chat',
      theme: { logoKey: 'uploads/u1/logo' },
    });
    put(teamDirectoryPk(), teamDirectorySk('Solo', 'solo'), { teamId: 'solo' });
    put(teamPk('solo'), 'INVITE#player', { code: 'abc', teamId: 'solo', role: 'player' });
    put(invitePk('abc'), inviteMetaSk(), { code: 'abc', teamId: 'solo' });
    put(chatPk('solo-channel'), chatMemberSk('u1'), { userId: 'u1' });
    put(chatPk('solo-channel'), messageSk('2026-01-01T00:00:00.000Z', 'm1'), { senderId: 'u1' });
    put(userPk('u1'), userChatSk('solo-channel'), { chatId: 'solo-channel', kind: 'channel', teamId: 'solo' });

    // A game shared with the Rivals, who keep theirs without the link.
    put(fixturePk('fx'), fixtureMetaSk(), {
      fixtureId: 'fx',
      homeTeamId: 'solo',
      awayTeamId: 'rivals',
      homeEventId: 'e1',
      awayEventId: 'e2',
      proposerTeamId: 'solo',
      inviteeTeamId: 'rivals',
      status: 'linked',
    });
    put(teamPk('solo'), fixtureLinkSk('fx'), { fixtureId: 'fx', teamId: 'solo' });
    put(teamPk('rivals'), fixtureLinkSk('fx'), { fixtureId: 'fx', teamId: 'rivals' });
    put(teamPk('rivals'), eventSk('e2'), { eventId: 'e2', title: 'At Solo', fixtureId: 'fx' });
    join('r1', 'rivals', ['team_admin']);

    await deleteAccount('u1');

    expect([...store.keys()].filter((key) => key.startsWith(`${teamPk('solo')}\0`))).toEqual([]);
    expect([...store.keys()].filter((key) => key.startsWith(`${chatPk('solo-chat')}\0`))).toEqual([]);
    expect([...store.keys()].filter((key) => key.startsWith(`${chatPk('solo-channel')}\0`))).toEqual([]);
    expect(has(teamDirectoryPk(), teamDirectorySk('Solo', 'solo'))).toBe(false);
    expect(has(invitePk('abc'), inviteMetaSk())).toBe(false);
    expect(has(fixturePk('fx'), fixtureMetaSk())).toBe(false);
    expect(has(teamPk('rivals'), fixtureLinkSk('fx'))).toBe(false);
    expect(store.get(itemKey(teamPk('rivals'), eventSk('e2')))).toMatchObject({ title: 'At Solo' });
    expect(store.get(itemKey(teamPk('rivals'), eventSk('e2')))?.fixtureId).toBeUndefined();
    expect(s3Send).toHaveBeenCalledWith(
      expect.objectContaining({ input: { Bucket: 'media', Key: 'uploads/u1/logo' } }),
    );
  });

  it('keeps an empty team that an organization looks after, and a team with others on it', async () => {
    join('u1', 'club-team', ['team_admin']);
    put(teamPk('club-team'), teamOrgSk(), { teamId: 'club-team', orgId: 'org-1' });
    join('u1', 'shared', ['player']);
    join('u2', 'shared', ['team_admin']);

    await deleteAccount('u1');

    expect(has(teamPk('club-team'), teamMetaSk())).toBe(true);
    expect(has(teamPk('club-team'), teamMemberSk('u1'))).toBe(false);
    expect(has(teamPk('shared'), teamMetaSk())).toBe(true);
    expect(has(teamPk('shared'), teamMemberSk('u1'))).toBe(false);
  });

  it('removes a minor from their guardians', async () => {
    put(userPk('m1'), guardianSk('u1'), { minorId: 'm1', adultId: 'u1' });
    put(userPk('u1'), childSk('m1'), { minorId: 'm1', adultId: 'u1' });

    await deleteAccount('m1');

    expect(has(userPk('u1'), childSk('m1'))).toBe(false);
  });
});
