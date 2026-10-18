/**
 * Direct team-store coverage for edge cases not hit by HTTP tests.
 */

import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryTable } from '../../lib/dynamo/memory-table.js';
import type { AccountKind } from '@gameplan/types';
import { DEFAULT_ROLE_PERMISSIONS } from '@gameplan/types';
import type { UserProfileItem } from '../../lib/auth/identity-provider.js';
import {
  TABLE_PK,
  TABLE_SK,
  chatMemberSk,
  chatMetaSk,
  chatPk,
  fixtureLinkSk,
  fixtureMetaSk,
  fixturePk,
  joinRequestSk,
  teamDirectoryPk,
  teamDirectorySk,
  inviteMetaSk,
  invitePk,
  rolePermissionsSk,
  teamMemberSk,
  teamMetaSk,
  teamPk,
  userChatSk,
  userPk,
  userTeamSk,
} from '../../lib/dynamo/keys.js';

const { store, itemKey } = memoryTable;
const profiles = new Map<string, UserProfileItem>();


vi.mock('../../lib/auth/profile.js', () => ({
  getProfile: async (userId: string) => profiles.get(userId),
}));

vi.mock('../../lib/dynamo/access.js', async () => (await import('../../lib/dynamo/memory-table.js')).memoryAccess);

const { assertRoleAllowedForAccount, callerCanGrant, highestRole, rolesFromMembership } =
  await import('@gameplan/rules');

const { assertAccountMayHoldRole, assertCanCreateTeam, assertProposedRolePermissions } =
  await import('../../lib/role-rules.js');

const {
  acceptInvite,
  approveJoinRequest,
  createJoinRequest,
  createTeam,
  rejectJoinRequest,
  requireMembership,
  searchTeamDirectory,
  assignMemberRole,
  setMemberPositions,
  toTeamSummary,
  updateTeamSettings,
} = await import('./team-store.js');

const seedProfile = (userId: string, accountKind: AccountKind): void => {
  profiles.set(userId, {
    PK: `USER#${userId}`,
    SK: 'PROFILE',
    userId,
    email: `${userId}@example.com`,
    displayName: 'Test User',
    accountKind,
    createdAt: new Date().toISOString(),
  });
};

describe('team-store edge cases', () => {
  beforeEach(() => {
    store.clear();
    profiles.clear();
  });

  afterEach(() => {
    store.clear();
    profiles.clear();
  });

  it('maps team summaries with optional location, theme, and positions', () => {
    expect(
      toTeamSummary(
        {
          teamId: 't1',
          name: 'Hawks',
          timeZone: 'UTC',
          location: 'Field',
          theme: { primary: '#000000', secondary: '#ffffff', accent: '#ff0000' },
          defaultChatId: 'c1',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        'team_admin',
        ['Fly-half'],
      ),
    ).toMatchObject({ location: 'Field', theme: expect.any(Object), positions: ['Fly-half'] });
    expect(
      toTeamSummary(
        {
          teamId: 't1',
          name: 'Hawks',
          timeZone: 'UTC',
          defaultChatId: 'c1',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        'coach',
      ).positions,
    ).toBeUndefined();
  });

  it('requireMembership throws for absent roster rows', async () => {
    await expect(requireMembership(randomUUID(), randomUUID())).rejects.toThrow('not_a_member');
  });

  it('assertRoleAllowedForAccount rejects minors with manage permissions', () => {
    expect(() =>
      assertRoleAllowedForAccount('minor', 'coach', {
        coach: ['manage_permissions'],
      }),
    ).toThrow('minor_cannot_hold_manage_permissions');
  });

  it('searchTeamDirectory lists teams without a name filter', async () => {
    const teamId = randomUUID();
    store.set(itemKey(teamDirectoryPk(), teamDirectorySk('Alpha', teamId)), {
      [TABLE_PK]: teamDirectoryPk(),
      [TABLE_SK]: teamDirectorySk('Alpha', teamId),
      teamId,
      name: 'Alpha',
      nameSearch: 'alpha',
      timeZone: 'UTC',
    });
    const page = await searchTeamDirectory('');
    expect(page.teams).toHaveLength(1);
  });

  it('createJoinRequest rejects members and duplicate pending requests', async () => {
    const adminId = randomUUID();
    seedProfile(adminId, 'adult');
    const team = await createTeam({
      name: 'Hawks',
      timeZone: 'UTC',
      userId: adminId,
    });
    const memberId = adminId;
    await expect(createJoinRequest(team.teamId, memberId)).rejects.toThrow('already_a_member');

    const outsider = randomUUID();
    seedProfile(outsider, 'adult');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    process.env.FANOUT_DELIVER_URL = 'http://127.0.0.1:9/fanout/deliver';
    await createJoinRequest(team.teamId, outsider);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:9/fanout/deliver',
      expect.objectContaining({ method: 'POST' }),
    );
    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      type: string;
      teamName: string;
      requesterDisplayName: string;
    };
    expect(sent).toMatchObject({
      type: 'join_requested',
      teamName: 'Hawks',
      requesterDisplayName: 'Test User',
    });
    delete process.env.FANOUT_DELIVER_URL;
    fetchMock.mockRestore();
    await expect(createJoinRequest(team.teamId, outsider)).rejects.toThrow('join_request_exists');
  });

  it('approveJoinRequest cleans up when the user is already a member', async () => {
    const adminId = randomUUID();
    seedProfile(adminId, 'adult');
    const team = await createTeam({
      name: 'Hawks',
      timeZone: 'UTC',
      userId: adminId,
    });
    const requestId = randomUUID();
    store.set(itemKey(teamPk(team.teamId), joinRequestSk(requestId)), {
      [TABLE_PK]: teamPk(team.teamId),
      [TABLE_SK]: joinRequestSk(requestId),
      requestId,
      userId: adminId,
      createdAt: new Date().toISOString(),
    });
    await expect(
      approveJoinRequest(team.teamId, requestId, 'player'),
    ).rejects.toThrow('already_a_member');
    expect(store.has(itemKey(teamPk(team.teamId), joinRequestSk(requestId)))).toBe(false);
  });

  it('rejectJoinRequest deletes a pending row', async () => {
    const adminId = randomUUID();
    seedProfile(adminId, 'adult');
    const team = await createTeam({
      name: 'Hawks',
      timeZone: 'UTC',
      userId: adminId,
    });
    const requestId = randomUUID();
    store.set(itemKey(teamPk(team.teamId), joinRequestSk(requestId)), {
      [TABLE_PK]: teamPk(team.teamId),
      [TABLE_SK]: joinRequestSk(requestId),
      requestId,
      userId: randomUUID(),
      createdAt: new Date().toISOString(),
    });
    await rejectJoinRequest(team.teamId, requestId);
    expect(store.has(itemKey(teamPk(team.teamId), joinRequestSk(requestId)))).toBe(false);
  });

  it('stores deduplicated positions and clears blank team locations', async () => {
    const adminId = randomUUID();
    seedProfile(adminId, 'adult');
    const team = await createTeam({
      name: 'Hawks',
      timeZone: 'UTC',
      userId: adminId,
    });
    const member = await setMemberPositions(team.teamId, adminId, ['Wing', 'wing', 'Fly-half']);
    expect(member.positions).toEqual(['Wing', 'Fly-half']);
    const updated = await updateTeamSettings({
      teamId: team.teamId,
      location: '   ',
    });
    expect(updated.location).toBeUndefined();
  });

  it('requireTeam throws when metadata is missing', async () => {
    await expect(createJoinRequest(randomUUID(), randomUUID())).rejects.toThrow('team_not_found');
  });

  it('setMemberPositions stores every distinct position', async () => {
    const adminId = randomUUID();
    seedProfile(adminId, 'adult');
    const team = await createTeam({
      name: 'Hawks',
      timeZone: 'UTC',
      userId: adminId,
    });
    const tooMany = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
    const member = await setMemberPositions(team.teamId, adminId, tooMany);
    expect(member.positions).toEqual(tooMany);
  });

  it('assertCanCreateTeam rejects a missing creator profile', async () => {
    await expect(assertCanCreateTeam(randomUUID())).rejects.toThrow('profile_not_found');
  });

  it('listUserTeams skips missing teams and recovers teamId from the sort key', async () => {
    const adminId = randomUUID();
    seedProfile(adminId, 'adult');
    const team = await createTeam({
      name: 'Hawks',
      timeZone: 'UTC',
      userId: adminId,
    });
    const userId = randomUUID();
    store.set(itemKey(userPk(userId), userTeamSk(team.teamId)), {
      [TABLE_PK]: userPk(userId),
      [TABLE_SK]: userTeamSk(team.teamId),
      // Non-string teamId: list should still use the TEAM# sort key.
      teamId: 42,
      role: 'player',
      joinedAt: new Date().toISOString(),
    });
    store.set(itemKey(userPk(userId), userTeamSk('ghost-team')), {
      [TABLE_PK]: userPk(userId),
      [TABLE_SK]: userTeamSk('ghost-team'),
      teamId: 'ghost-team',
      role: 'player',
      joinedAt: new Date().toISOString(),
    });
    const { listUserTeams } = await import('./team-store.js');
    const listed = await listUserTeams(userId);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.team.teamId).toBe(team.teamId);
    expect(listed[0]?.role).toBe('player');
  });

  it('updateTeamSettings clears theme and rejects blank name', async () => {
    const adminId = randomUUID();
    seedProfile(adminId, 'adult');
    const team = await createTeam({
      name: 'Hawks',
      timeZone: 'UTC',
      userId: adminId,
    });
    const cleared = await updateTeamSettings({
      teamId: team.teamId,
      theme: null,
    });
    expect(cleared.theme).toBeUndefined();
    await expect(
      updateTeamSettings({ teamId: team.teamId, name: '   ' }),
    ).rejects.toThrow('invalid_body');
  });

  it('acceptInvite and approveJoinRequest require profiles', async () => {
    const adminId = randomUUID();
    seedProfile(adminId, 'adult');
    const team = await createTeam({
      name: 'Hawks',
      timeZone: 'UTC',
      userId: adminId,
    });
    const code = 'invite-code';
    store.set(itemKey(invitePk(code), inviteMetaSk()), {
      [TABLE_PK]: invitePk(code),
      [TABLE_SK]: inviteMetaSk(),
      code,
      teamId: team.teamId,
      role: 'player',
      createdAt: new Date().toISOString(),
    });
    const outsider = randomUUID();
    await expect(assertAccountMayHoldRole(outsider, team.teamId, 'player')).rejects.toThrow(
      'profile_not_found',
    );
    await expect(acceptInvite(code, outsider)).resolves.toMatchObject({
      member: { role: 'player', userId: outsider },
    });

    const requestId = randomUUID();
    store.set(itemKey(teamPk(team.teamId), joinRequestSk(requestId)), {
      [TABLE_PK]: teamPk(team.teamId),
      [TABLE_SK]: joinRequestSk(requestId),
      requestId,
      userId: outsider,
      createdAt: new Date().toISOString(),
    });
    await expect(approveJoinRequest(team.teamId, requestId, 'player')).rejects.toThrow(
      'already_a_member',
    );
    await expect(rejectJoinRequest(team.teamId, randomUUID())).rejects.toThrow(
      'join_request_not_found',
    );
  });

  it('assertRoleAllowedForAccount uses default permissions for unknown roles', () => {
    expect(() =>
      assertRoleAllowedForAccount('adult', 'parent', {}),
    ).not.toThrow();
  });

  it('callerCanGrant ranks player above parent', () => {
    expect(callerCanGrant('player', 'parent')).toBe(true);
    expect(callerCanGrant('parent', 'player')).toBe(false);
    expect(highestRole(['parent', 'coach'])).toBe('coach');
    expect(rolesFromMembership({ role: 'player' })).toEqual(['player']);
    expect(rolesFromMembership({ role: 'parent', roles: ['coach', 'parent'] })).toEqual([
      'coach',
      'parent',
    ]);
  });

  it('assignMemberRole stores the set and keeps positions', async () => {
    const adminId = randomUUID();
    seedProfile(adminId, 'adult');
    const team = await createTeam({
      name: 'Hawks',
      timeZone: 'UTC',
      userId: adminId,
    });
    const updated = await assignMemberRole(team.teamId, adminId, ['parent', 'coach']);
    expect(updated.role).toBe('coach');
    expect(updated.roles).toEqual(['coach', 'parent']);
    const stored = store.get(itemKey(teamPk(team.teamId), teamMemberSk(adminId)));
    expect(stored).toMatchObject({ role: 'coach', roles: ['coach', 'parent'] });
    const userSide = store.get(itemKey(userPk(adminId), userTeamSk(team.teamId)));
    expect(userSide).toMatchObject({ role: 'coach', roles: ['coach', 'parent'] });

    store.set(itemKey(teamPk(team.teamId), teamMemberSk(adminId)), {
      ...stored,
      roles: undefined,
      positions: ['Wing'],
    });
    store.set(itemKey(userPk(adminId), userTeamSk(team.teamId)), {
      ...userSide,
      roles: undefined,
      positions: ['Wing'],
    });
    const kept = await setMemberPositions(team.teamId, adminId, ['Wing']);
    expect(kept.roles).toEqual(['coach']);
    expect(kept.positions).toEqual(['Wing']);
  });

  it('assertProposedRolePermissions skips members without profiles', async () => {
    const adminId = randomUUID();
    seedProfile(adminId, 'adult');
    const team = await createTeam({
      name: 'Hawks',
      timeZone: 'UTC',
      userId: adminId,
    });
    const ghostCoach = randomUUID();
    store.set(itemKey(teamPk(team.teamId), teamMemberSk(ghostCoach)), {
      [TABLE_PK]: teamPk(team.teamId),
      [TABLE_SK]: teamMemberSk(ghostCoach),
      userId: ghostCoach,
      role: 'coach',
      joinedAt: new Date().toISOString(),
    });
    await expect(
      assertProposedRolePermissions(team.teamId, [
        {
          role: 'coach',
          permissions: [...DEFAULT_ROLE_PERMISSIONS.coach, 'manage_permissions'],
        },
      ]),
    ).resolves.toBeUndefined();
  });

  it('approveJoinRequest rejects missing join requests', async () => {
    const adminId = randomUUID();
    seedProfile(adminId, 'adult');
    const team = await createTeam({
      name: 'Hawks',
      timeZone: 'UTC',
      userId: adminId,
    });
    await expect(approveJoinRequest(team.teamId, randomUUID(), 'player')).rejects.toThrow(
      'join_request_not_found',
    );
  });

  it('assertProposedRolePermissions rejects minors holding manage_permissions', async () => {
    const adminId = randomUUID();
    seedProfile(adminId, 'adult');
    const team = await createTeam({
      name: 'Hawks',
      timeZone: 'UTC',
      userId: adminId,
    });
    const minorId = randomUUID();
    seedProfile(minorId, 'minor');
    store.set(itemKey(teamPk(team.teamId), teamMemberSk(minorId)), {
      [TABLE_PK]: teamPk(team.teamId),
      [TABLE_SK]: teamMemberSk(minorId),
      userId: minorId,
      role: 'coach',
      joinedAt: new Date().toISOString(),
    });
    await expect(
      assertProposedRolePermissions(team.teamId, [
        { role: 'coach', permissions: [...DEFAULT_ROLE_PERMISSIONS.coach, 'manage_permissions'] },
      ]),
    ).rejects.toThrow('minor_cannot_hold_manage_permissions');
  });

  it('rewrites fixture-chat membership when a role changes', async () => {
    const adminId = randomUUID();
    seedProfile(adminId, 'adult');
    const home = await createTeam({ name: 'Pigs', timeZone: 'UTC', userId: adminId, sport: 'Rugby' });
    const awayAdmin = randomUUID();
    seedProfile(awayAdmin, 'adult');
    const away = await createTeam({ name: 'Seacoast', timeZone: 'UTC', userId: awayAdmin, sport: 'rugby' });
    store.set(itemKey(teamPk(home.teamId), rolePermissionsSk('coach')), {
      [TABLE_PK]: teamPk(home.teamId),
      [TABLE_SK]: rolePermissionsSk('coach'),
      role: 'coach',
      permissions: ['manage_events'],
    });
    const coachId = randomUUID();
    seedProfile(coachId, 'adult');
    store.set(itemKey(teamPk(home.teamId), teamMemberSk(coachId)), {
      [TABLE_PK]: teamPk(home.teamId),
      [TABLE_SK]: teamMemberSk(coachId),
      userId: coachId,
      role: 'player',
      joinedAt: new Date().toISOString(),
    });
    store.set(itemKey(userPk(coachId), userTeamSk(home.teamId)), {
      [TABLE_PK]: userPk(coachId),
      [TABLE_SK]: userTeamSk(home.teamId),
      teamId: home.teamId,
      role: 'player',
      joinedAt: new Date().toISOString(),
    });
    const fixtureId = randomUUID();
    const chatId = randomUUID();
    store.set(itemKey(fixturePk(fixtureId), fixtureMetaSk()), {
      [TABLE_PK]: fixturePk(fixtureId),
      [TABLE_SK]: fixtureMetaSk(),
      fixtureId,
      status: 'linked',
      chatId,
      homeName: 'Pigs',
      awayName: 'Seacoast',
      homeTeamId: home.teamId,
      awayTeamId: away.teamId,
      createdBy: adminId,
    });
    for (const teamId of [home.teamId, away.teamId]) {
      store.set(itemKey(teamPk(teamId), fixtureLinkSk(fixtureId)), {
        [TABLE_PK]: teamPk(teamId),
        [TABLE_SK]: fixtureLinkSk(fixtureId),
        fixtureId,
        chatId,
        status: 'linked',
      });
    }
    store.set(itemKey(chatPk(chatId), chatMetaSk()), {
      [TABLE_PK]: chatPk(chatId),
      [TABLE_SK]: chatMetaSk(),
      chatId,
      kind: 'fixture',
      name: 'Pigs vs Seacoast',
      createdBy: adminId,
      createdAt: new Date().toISOString(),
    });
    for (const userId of [adminId, awayAdmin]) {
      store.set(itemKey(chatPk(chatId), chatMemberSk(userId)), {
        [TABLE_PK]: chatPk(chatId),
        [TABLE_SK]: chatMemberSk(userId),
        userId,
        joinedAt: new Date().toISOString(),
      });
    }

    await assignMemberRole(home.teamId, coachId, ['coach']);
    expect(store.has(itemKey(chatPk(chatId), chatMemberSk(coachId)))).toBe(true);
    expect(store.has(itemKey(userPk(coachId), userChatSk(chatId)))).toBe(true);
    expect(home.sport).toBe('rugby');

    await assignMemberRole(home.teamId, coachId, ['player']);
    expect(store.has(itemKey(chatPk(chatId), chatMemberSk(coachId)))).toBe(false);
    expect(store.has(itemKey(chatPk(chatId), chatMemberSk(adminId)))).toBe(true);
    expect(store.has(itemKey(chatPk(chatId), chatMemberSk(awayAdmin)))).toBe(true);
  });
});
