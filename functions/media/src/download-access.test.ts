/**
 * Who may download a media key: owner, chat member, teammate, or team member.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryTable } from '../../lib/dynamo/memory-table.js';
import {
  TABLE_PK,
  TABLE_SK,
  chatMemberSk,
  chatPk,
  messageSk,
  teamMetaSk,
  teamPk,
  userPk,
  userTeamSk,
} from '../../lib/dynamo/keys.js';

const { photoKeys } = vi.hoisted(() => ({ photoKeys: new Map<string, string>() }));

vi.mock('../../lib/dynamo/access.js', async () => (await import('../../lib/dynamo/memory-table.js')).memoryAccess);

vi.mock('../../lib/auth/profile.js', () => ({
  getProfile: async (userId: string) =>
    photoKeys.has(userId) ? { userId, photoKey: photoKeys.get(userId) } : undefined,
}));

const { assertCanDownload } = await import('./download-access.js');

const row = (pk: string, sk: string, fields: Record<string, unknown> = {}): void =>
  memoryTable.put({ [TABLE_PK]: pk, [TABLE_SK]: sk, ...fields });

const joinTeam = (userId: string, teamId: string, withTeamId = true): void =>
  row(userPk(userId), userTeamSk(teamId), withTeamId ? { teamId } : {});

describe('assertCanDownload', () => {
  beforeEach(() => {
    memoryTable.clear();
    photoKeys.clear();
  });

  it('rejects keys that try to leave their folder', async () => {
    for (const key of ['uploads/a/../b', '/uploads/a/x', 'uploads\\a']) {
      await expect(assertCanDownload('a', key, {})).rejects.toThrow('invalid_object_key');
    }
  });

  it('lets the uploader download their own key with no context', async () => {
    await expect(assertCanDownload('a', 'uploads/a/photo', {})).resolves.toBeUndefined();
    await expect(assertCanDownload('a', 'uploads/b/photo', {})).rejects.toThrow('forbidden');
  });

  it('needs chat membership and the key on a message in that chat', async () => {
    const key = 'uploads/b/pic';
    await expect(assertCanDownload('a', key, { chatId: 'c1' })).rejects.toThrow('forbidden');
    row(chatPk('c1'), chatMemberSk('a'));
    await expect(assertCanDownload('a', key, { chatId: 'c1' })).rejects.toThrow('forbidden');
    row(chatPk('c1'), messageSk('2026-01-01T00:00:00.000Z', 'm1'), { attachmentKeys: 'not-a-list' });
    row(chatPk('c1'), messageSk('2026-01-02T00:00:00.000Z', 'm2'), { attachmentKeys: [key] });
    await expect(assertCanDownload('a', key, { chatId: 'c1' })).resolves.toBeUndefined();
  });

  it('shows a profile photo to its owner and to teammates only', async () => {
    const key = 'uploads/b/face';
    await expect(assertCanDownload('a', key, { userId: 'b' })).rejects.toThrow('forbidden');
    photoKeys.set('b', key);
    await expect(assertCanDownload('b', key, { userId: 'b' })).resolves.toBeUndefined();
    await expect(assertCanDownload('a', key, { userId: 'b' })).rejects.toThrow('forbidden');

    joinTeam('a', 't1');
    joinTeam('b', 't2');
    await expect(assertCanDownload('a', key, { userId: 'b' })).rejects.toThrow('forbidden');

    // Older rows carry the team only in the sort key; an empty one is skipped.
    row(userPk('b'), userTeamSk(''), { teamId: '' });
    joinTeam('b', 't1', false);
    await expect(assertCanDownload('a', key, { userId: 'b' })).resolves.toBeUndefined();
  });

  it('shows a team logo or chat background to that team only', async () => {
    await expect(assertCanDownload('a', 'uploads/c/logo', { teamId: 't1' })).rejects.toThrow('forbidden');
    joinTeam('a', 't1');
    await expect(assertCanDownload('a', 'uploads/c/logo', { teamId: 't1' })).rejects.toThrow('forbidden');
    row(teamPk('t1'), teamMetaSk(), { theme: { logoKey: 'uploads/c/logo', chatBackgroundKey: 'uploads/c/bg' } });
    await expect(assertCanDownload('a', 'uploads/c/logo', { teamId: 't1' })).resolves.toBeUndefined();
    await expect(assertCanDownload('a', 'uploads/c/bg', { teamId: 't1' })).resolves.toBeUndefined();
    await expect(assertCanDownload('a', 'uploads/c/other', { teamId: 't1' })).rejects.toThrow('forbidden');
  });
});
