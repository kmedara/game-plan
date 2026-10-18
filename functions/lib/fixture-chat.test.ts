/**
 * Fixture staff threads: who may post, who belongs, and when a refresh runs.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryTable } from './dynamo/memory-table.js';
import {
  TABLE_PK,
  TABLE_SK,
  chatMetaSk,
  chatPk,
  fixtureLinkSk,
  fixtureMetaSk,
  fixturePk,
  teamMemberSk,
  teamPk,
} from './dynamo/keys.js';
import { listChatMemberIds } from './chat-membership.js';

vi.mock('./dynamo/access.js', async () => (await import('./dynamo/memory-table.js')).memoryAccess);

vi.mock('./permissions.js', () => ({
  loadRolePermissionMatrix: async () => ({ coach: ['manage_events'], player: [] }),
}));

const {
  assertCanManageEvents,
  dissolveFixtureChat,
  eventManagerIds,
  fixtureChatName,
  refreshFixtureChat,
  refreshTeamFixtureChats,
  syncFixtureChat,
} = await import('./fixture-chat.js');

const member = (teamId: string, userId: string | number, role: string): void =>
  memoryTable.put({ [TABLE_PK]: teamPk(teamId), [TABLE_SK]: teamMemberSk(String(userId)), userId, role });

const chatName = (chatId: string): unknown => memoryTable.get(chatPk(chatId), chatMetaSk())?.name;

describe('fixture chat', () => {
  beforeEach(() => memoryTable.clear());

  it('lets coaches manage events and turns away players and outsiders', async () => {
    member('home', 'coach-1', 'coach');
    member('home', 'player-1', 'player');
    await expect(assertCanManageEvents('home', 'coach-1')).resolves.toBeUndefined();
    await expect(assertCanManageEvents('home', 'player-1')).rejects.toThrow('forbidden');
    await expect(assertCanManageEvents('home', 'stranger')).rejects.toThrow('not_a_member');
  });

  it('lists only event managers with a usable id', async () => {
    member('home', 'coach-1', 'coach');
    member('home', 'player-1', 'player');
    member('home', 42, 'coach');
    expect(await eventManagerIds('home')).toEqual(['coach-1']);
  });

  it('caps the thread name at 100 characters', () => {
    expect(fixtureChatName('Hawks', 'Owls')).toBe('Hawks vs Owls');
    expect(fixtureChatName('H'.repeat(60), 'O'.repeat(60))).toHaveLength(100);
  });

  it('renames an existing thread and leaves the name alone when it matches', async () => {
    await syncFixtureChat({ chatId: 'c1', name: 'A vs B', createdBy: 'u1', memberIds: ['u1'] });
    await syncFixtureChat({ chatId: 'c1', name: 'A vs B', createdBy: 'u1', memberIds: ['u1'] });
    expect(chatName('c1')).toBe('A vs B');
    await syncFixtureChat({ chatId: 'c1', name: 'A vs C', createdBy: 'u1', memberIds: ['u1'] });
    expect(chatName('c1')).toBe('A vs C');
  });

  it('skips fixtures that are not linked or lack a team, and fills missing names', async () => {
    member('home', 'coach-h', 'coach');
    member('away', 'coach-a', 'coach');
    await refreshFixtureChat({ status: 'pending', chatId: 'c1', homeTeamId: 'home', awayTeamId: 'away' });
    await refreshFixtureChat({ status: 'linked', homeTeamId: 'home', awayTeamId: 'away' });
    await refreshFixtureChat({ status: 'linked', chatId: 'c1', homeTeamId: 'home' });
    await refreshFixtureChat({ status: 'linked', chatId: 'c1', awayTeamId: 'away' });
    expect(chatName('c1')).toBeUndefined();

    await refreshFixtureChat({ status: 'linked', chatId: 'c1', homeTeamId: 'home', awayTeamId: 'away' });
    expect(chatName('c1')).toBe('Home vs Away');
    expect((await listChatMemberIds('c1')).sort()).toEqual(['coach-a', 'coach-h']);
    expect(memoryTable.get(chatPk('c1'), chatMetaSk())?.createdBy).toBe('coach-h');
  });

  it('names the creator after the chat when neither club has staff', async () => {
    await refreshFixtureChat({ status: 'linked', chatId: 'c2', homeTeamId: 'x', awayTeamId: 'y', homeName: 'X', awayName: 'Y' });
    expect(memoryTable.get(chatPk('c2'), chatMetaSk())).toMatchObject({ name: 'X vs Y', createdBy: 'c2' });
  });

  it('removes every member and the thread when a fixture is unlinked', async () => {
    await syncFixtureChat({ chatId: 'c1', name: 'A vs B', createdBy: 'u1', memberIds: ['u1', 'u2'] });
    await dissolveFixtureChat('c1');
    expect(await listChatMemberIds('c1')).toEqual([]);
    expect(memoryTable.get(chatPk('c1'), chatMetaSk())).toBeUndefined();
  });

  it('refreshes each complete link for a team and skips broken ones', async () => {
    member('home', 'coach-h', 'coach');
    const link = (fixtureId: string, fields: Record<string, unknown>): void =>
      memoryTable.put({ [TABLE_PK]: teamPk('home'), [TABLE_SK]: fixtureLinkSk(fixtureId), ...fields });
    link('f1', { fixtureId: 'f1', chatId: 'c1' });
    link('f2', { fixtureId: 'f2' });
    link('f3', { chatId: 'c3' });
    link('f4', { fixtureId: 'f4', chatId: 'c4' });
    memoryTable.put({
      [TABLE_PK]: fixturePk('f1'),
      [TABLE_SK]: fixtureMetaSk(),
      status: 'linked',
      chatId: 'c1',
      homeTeamId: 'home',
      awayTeamId: 'away',
      homeName: 'Hawks',
      awayName: 'Owls',
      createdBy: 'coach-h',
    });

    await refreshTeamFixtureChats('home');
    expect(chatName('c1')).toBe('Hawks vs Owls');
    expect(chatName('c4')).toBeUndefined();
  });
});
