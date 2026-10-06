/**
 * Direct team-store coverage for edge cases not hit by HTTP tests.
 */

import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountKind } from '@gameplan/types';
import { DEFAULT_ROLE_PERMISSIONS } from '@gameplan/types';
import type { UserProfileItem } from '../../lib/auth/identity-provider.js';
import {
  TABLE_PK,
  TABLE_SK,
  joinRequestSk,
  teamDirectoryPk,
  teamDirectorySk,
  inviteMetaSk,
  invitePk,
  teamMemberSk,
  teamMetaSk,
  teamPk,
  userPk,
  userTeamSk,
} from '../../lib/dynamo/keys.js';

const store = new Map<string, Record<string, unknown>>();
const profiles = new Map<string, UserProfileItem>();

const itemKey = (pk: string, sk: string): string => `${pk}\0${sk}`;

vi.mock('../../lib/auth/profile.js', () => ({
  getProfile: async (userId: string) => profiles.get(userId),
}));

vi.mock('../../lib/dynamo/access.js', () => ({
  getItem: async <T extends Record<string, unknown>>(pk: string, sk: string) =>
    store.get(itemKey(pk, sk)) as T | undefined,
  putItem: async (item: Record<string, unknown>): Promise<void> => {
    store.set(itemKey(String(item[TABLE_PK]), String(item[TABLE_SK])), item);
  },
  deleteItem: async (pk: string, sk: string): Promise<void> => {
    store.delete(itemKey(pk, sk));
  },
  transactWrite: async (
    items: Array<{ Put?: { Item: Record<string, unknown> }; Delete?: { Key: Record<string, unknown> } }>,
  ): Promise<void> => {
    for (const entry of items) {
      if (entry.Put?.Item !== undefined) {
        const item = entry.Put.Item;
        store.set(itemKey(String(item[TABLE_PK]), String(item[TABLE_SK])), item);
      }
      if (entry.Delete?.Key !== undefined) {
        const pk = String(entry.Delete.Key[TABLE_PK]);
        const sk = String(entry.Delete.Key[TABLE_SK]);
        store.delete(itemKey(pk, sk));
      }
    }
  },
  queryBySkPrefix: async <T extends Record<string, unknown>>(pk: string, skPrefix: string) => {
    const items: T[] = [];
    for (const [key, item] of store) {
      const [itemPk, itemSk] = key.split('\0');
      if (itemPk === pk && itemSk.startsWith(skPrefix)) items.push(item as T);
    }
    return items;
  },
  queryPage: async <T extends Record<string, unknown>>(
    input: { ExpressionAttributeValues?: Record<string, unknown> },
    options: { limit: number; cursor?: string },
  ) => {
    const pk = String(input.ExpressionAttributeValues?.[':pk'] ?? '');
    const skPrefix = String(input.ExpressionAttributeValues?.[':skPrefix'] ?? '');
    const needle = input.ExpressionAttributeValues?.[':needle'];
    const all: T[] = [];
    for (const [key, item] of store) {
      const [itemPk, itemSk] = key.split('\0');
      if (itemPk !== pk || !itemSk.startsWith(skPrefix)) continue;
      if (typeof needle === 'string' && !String(item.nameSearch ?? '').includes(needle)) continue;
      all.push(item as T);
    }
    const start = options.cursor !== undefined ? Number(options.cursor) : 0;
    const end = start + options.limit;
    return { items: all.slice(start, end), ...(end < all.length ? { cursor: String(end) } : {}) };
  },
  queryAll: async () => [],
  queryPartition: async () => [],
  encodeCursor: () => undefined,
  decodeCursor: () => undefined,
}));

const {
  acceptInvite,
  assertRoleAllowedForAccount,
  approveJoinRequest,
  createJoinRequest,
  createTeam,
  rejectJoinRequest,
  requireMembership,
  searchTeamDirectory,
  setMemberPositions,
  toTeamSummary,
  updateRolePermissions,
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
    await createJoinRequest(team.teamId, outsider);
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

  it('normalizePositions rejects more than eight unique entries', async () => {
    const adminId = randomUUID();
    seedProfile(adminId, 'adult');
    const team = await createTeam({
      name: 'Hawks',
      timeZone: 'UTC',
      userId: adminId,
    });
    const tooMany = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
    await expect(setMemberPositions(team.teamId, adminId, tooMany)).rejects.toThrow(
      'too_many_positions',
    );
  });

  it('createTeam rejects missing creator profiles', async () => {
    await expect(
      createTeam({ name: 'Hawks', timeZone: 'UTC', userId: randomUUID() }),
    ).rejects.toThrow('profile_not_found');
  });

  it('listUserTeams skips broken membership rows and missing teams', async () => {
    const userId = randomUUID();
    const teamId = randomUUID();
    store.set(itemKey(userPk(userId), userTeamSk(teamId)), {
      [TABLE_PK]: userPk(userId),
      [TABLE_SK]: userTeamSk(teamId),
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
    expect(await listUserTeams(userId)).toEqual([]);
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
    await expect(acceptInvite(code, outsider)).rejects.toThrow('profile_not_found');

    const requestId = randomUUID();
    store.set(itemKey(teamPk(team.teamId), joinRequestSk(requestId)), {
      [TABLE_PK]: teamPk(team.teamId),
      [TABLE_SK]: joinRequestSk(requestId),
      requestId,
      userId: outsider,
      createdAt: new Date().toISOString(),
    });
    await expect(approveJoinRequest(team.teamId, requestId, 'player')).rejects.toThrow(
      'profile_not_found',
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

  it('updateRolePermissions skips members without profiles when checking manage_permissions', async () => {
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
      updateRolePermissions(team.teamId, [
        {
          role: 'coach',
          permissions: [...DEFAULT_ROLE_PERMISSIONS.coach, 'manage_permissions'],
        },
      ]),
    ).resolves.toBeDefined();
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

  it('updateRolePermissions rejects minors holding manage_permissions', async () => {
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
      updateRolePermissions(team.teamId, [
        { role: 'coach', permissions: [...DEFAULT_ROLE_PERMISSIONS.coach, 'manage_permissions'] },
      ]),
    ).rejects.toThrow('minor_cannot_hold_manage_permissions');
  });
});
