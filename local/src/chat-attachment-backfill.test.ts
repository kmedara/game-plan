/**
 * The one-off chat attachment index backfill.
 */

import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryTable } from '../../functions/lib/dynamo/memory-table.js';
import { chatAttachmentSk, chatPk, messageSk } from '../../functions/lib/dynamo/keys.js';

const { pages, send } = vi.hoisted(() => {
  const pages: Record<string, unknown>[][] = [];
  const send = vi.fn(async (command: { input: { ExclusiveStartKey?: { page: number } } }) => {
    const at = command.input.ExclusiveStartKey?.page ?? 0;
    return {
      Items: pages[at] ?? [],
      ...(at + 1 < pages.length ? { LastEvaluatedKey: { page: at + 1 } } : {}),
    };
  });
  return { pages, send };
});

vi.mock('../../functions/lib/dynamo/client.js', () => ({
  getDocClient: () => ({ send }),
  resetDocClient: () => undefined,
}));
vi.mock(
  '../../functions/lib/dynamo/access.js',
  async () => (await import('../../functions/lib/dynamo/memory-table.js')).memoryAccess,
);

const { backfillChatAttachments } = await import('./chat-attachment-backfill.js');

const message = (chatId: string, messageId: string, fields: Record<string, unknown>) => ({
  PK: chatPk(chatId),
  SK: messageSk('2026-10-06T12:00:00.000Z', messageId),
  messageId,
  ...fields,
});

const indexRow = (chatId: string, key: string) => memoryTable.get(chatPk(chatId), chatAttachmentSk(key));

describe('backfillChatAttachments', () => {
  beforeEach(() => {
    memoryTable.clear();
    pages.length = 0;
    send.mockClear();
  });

  it("indexes each sender's own uploads across scan pages and reports the rest", async () => {
    pages.push(
      [message('c1', 'm1', { senderId: 'u1', attachmentKeys: ['uploads/u1/a', 'uploads/u2/b', 42] })],
      [
        message('c2', 'm2', { senderId: 'u3', attachmentKeys: ['uploads/u3/c'] }),
        message('c2', 'm3', { senderId: 'u3', attachmentKeys: 'not-a-list' }),
        message('c2', 'm4', { attachmentKeys: ['uploads/u4/d'] }),
      ],
    );

    const result = await backfillChatAttachments();

    expect(result.messages).toBe(4);
    expect(result.indexed).toBe(2);
    expect(result.skipped).toEqual([
      { chatId: 'c1', messageId: 'm1', reason: 'not_sender_upload' },
      { chatId: 'c1', messageId: 'm1', reason: 'invalid_key' },
      { chatId: 'c2', messageId: 'm3', reason: 'invalid_key' },
      { chatId: 'c2', messageId: 'm4', reason: 'not_sender_upload' },
    ]);
    // The same row a send writes.
    expect(indexRow('c1', 'uploads/u1/a')).toMatchObject({ chatId: 'c1', messageId: 'm1', objectKey: 'uploads/u1/a' });
    expect(indexRow('c2', 'uploads/u3/c')).toMatchObject({ chatId: 'c2', messageId: 'm2', objectKey: 'uploads/u3/c' });
    expect(indexRow('c1', 'uploads/u2/b')).toBeUndefined();
    expect(indexRow('c2', 'uploads/u4/d')).toBeUndefined();

    expect(send).toHaveBeenCalledTimes(2);
    const scans = send.mock.calls.map(([command]) => command as unknown as ScanCommand);
    expect(scans.every((scan) => scan instanceof ScanCommand && scan.input.ConsistentRead === true)).toBe(true);
    expect(scans[0]?.input.ExclusiveStartKey).toBeUndefined();
    expect(scans[1]?.input.ExclusiveStartKey).toEqual({ page: 1 });
  });

  it('writes more rows than one batch and is safe to run again', async () => {
    const keys = Array.from({ length: 30 }, (_, index) => `uploads/u1/file-${index}`);
    pages.push([message('c1', 'm1', { senderId: 'u1', attachmentKeys: keys })]);

    expect((await backfillChatAttachments()).indexed).toBe(30);
    expect((await backfillChatAttachments()).indexed).toBe(30);
    expect(keys.every((key) => indexRow('c1', key) !== undefined)).toBe(true);
    expect(memoryTable.store.size).toBe(30);
  });

  it('counts without writing on a dry run', async () => {
    pages.push([message('c1', 'm1', { senderId: 'u1', attachmentKeys: ['uploads/u1/a'] })]);
    const progress = vi.fn();

    const result = await backfillChatAttachments({ dryRun: true, onPage: progress });

    expect(result).toEqual({ messages: 1, indexed: 1, skipped: [] });
    expect(progress).toHaveBeenCalledTimes(1);
    expect(memoryTable.store.size).toBe(0);
  });
});
