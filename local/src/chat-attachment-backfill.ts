/**
 * Writes the chat attachment index for messages sent before it existed.
 *
 * `sendMessage` writes `CHAT#<chatId>` / `ATTACH#<objectKey>` for each
 * attachment, and a media download checks only that row. Older messages list
 * their keys in `attachmentKeys` alone, so this scans the table once and
 * writes the rows they are missing.
 *
 * Only keys under the sender's own upload prefix are indexed, the rule
 * `sendMessage` enforces. Messages stored before that rule may name someone
 * else's upload; those keys are skipped and reported.
 *
 * Each row is written whole, so running this again is safe.
 */

import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import {
  MESSAGE_SK_PREFIX,
  TABLE_PK,
  TABLE_SK,
  chatAttachmentSk,
  chatPk,
  getDocClient,
  putItem,
} from '../../functions/lib/dynamo/index.js';
import { TABLE_NAME } from '../../functions/lib/names.js';
import { isOwnedUploadKey } from '../../functions/lib/upload-keys.js';

/** Index rows written in parallel. */
const WRITE_BATCH = 25;

/** The message fields the scan reads. */
type MessageRow = {
  PK: string;
  SK: string;
  messageId?: unknown;
  senderId?: unknown;
  attachmentKeys?: unknown;
};

/** An attachment entry that was not indexed. */
export type SkippedAttachment = {
  chatId: string;
  messageId?: string;
  /** `not_sender_upload` for someone else's key, `invalid_key` for anything that is not a key. */
  reason: 'not_sender_upload' | 'invalid_key';
};

/** What a run found, and wrote unless it was a dry run. */
export type BackfillResult = {
  /** Messages that list attachments. */
  messages: number;
  /** Index rows written, or that a dry run would write. */
  indexed: number;
  /** Entries left out. */
  skipped: SkippedAttachment[];
};

/**
 * Builds the index rows for one message, and notes the entries it leaves out.
 *
 * @param message - A scanned message row.
 * @param skipped - Receives the entries that are not indexed.
 * @returns The rows to write.
 */
const indexRowsFor = (message: MessageRow, skipped: SkippedAttachment[]): Record<string, unknown>[] => {
  const chatId = message.PK.slice(chatPk('').length);
  const messageId = typeof message.messageId === 'string' ? message.messageId : undefined;
  const where = { chatId, ...(messageId !== undefined ? { messageId } : {}) };
  if (!Array.isArray(message.attachmentKeys)) {
    skipped.push({ ...where, reason: 'invalid_key' });
    return [];
  }
  const rows: Record<string, unknown>[] = [];
  for (const key of message.attachmentKeys as unknown[]) {
    if (typeof key !== 'string' || key.length === 0) {
      skipped.push({ ...where, reason: 'invalid_key' });
    } else if (typeof message.senderId !== 'string' || !isOwnedUploadKey(message.senderId, key)) {
      skipped.push({ ...where, reason: 'not_sender_upload' });
    } else {
      rows.push({ [TABLE_PK]: message.PK, [TABLE_SK]: chatAttachmentSk(key), ...where, objectKey: key });
    }
  }
  return rows;
};

/**
 * Scans every chat message with attachments and writes the missing index rows.
 *
 * @param options - `dryRun` counts without writing. `onPage` hears the running
 *   totals after each scan page.
 * @returns The totals.
 */
export const backfillChatAttachments = async (
  options: { dryRun?: boolean; onPage?: (progress: BackfillResult) => void } = {},
): Promise<BackfillResult> => {
  const result: BackfillResult = { messages: 0, indexed: 0, skipped: [] };
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await getDocClient().send(
      new ScanCommand({
        TableName: TABLE_NAME,
        // Strongly consistent, so a message written just before the scan is not missed.
        ConsistentRead: true,
        FilterExpression: 'begins_with(#pk, :chat) AND begins_with(#sk, :message) AND attribute_exists(#keys)',
        ProjectionExpression: '#pk, #sk, #messageId, #senderId, #keys',
        ExpressionAttributeNames: {
          '#pk': TABLE_PK,
          '#sk': TABLE_SK,
          '#messageId': 'messageId',
          '#senderId': 'senderId',
          '#keys': 'attachmentKeys',
        },
        ExpressionAttributeValues: { ':chat': chatPk(''), ':message': MESSAGE_SK_PREFIX },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    const messages = (page.Items ?? []) as MessageRow[];
    const rows = messages.flatMap((message) => indexRowsFor(message, result.skipped));
    if (options.dryRun !== true) {
      for (let start = 0; start < rows.length; start += WRITE_BATCH) {
        await Promise.all(rows.slice(start, start + WRITE_BATCH).map((row) => putItem(row)));
      }
    }
    result.messages += messages.length;
    result.indexed += rows.length;
    options.onPage?.(result);
    exclusiveStartKey = page.LastEvaluatedKey;
  } while (exclusiveStartKey !== undefined);
  return result;
};
