/**
 * A team's album: photos and, on a paid plan, videos.
 *
 * Files are uploaded under the uploader's own prefix, then added here. Each
 * item is one `ALBUM#<itemId>` row on the team, plus an `ALBUM_OBJECT#<key>`
 * row that download checks read. `ALBUM_USAGE` keeps the bytes the album
 * holds; every add and remove rewrites it in the same transaction, guarded by
 * its version, so two adds at once cannot both squeeze under the plan's limit.
 */

import { randomUUID } from 'node:crypto';
import { albumUploadProblem, isAlbumVideo, type PlanLimits } from '@gameplan/rules';
import {
  albumContentTypeSchema,
  type AddAlbumItemBody,
  type AlbumContentType,
  type AlbumItem,
  type AlbumPage,
} from '@gameplan/schemas';
import {
  ALBUM_SK_PREFIX,
  TABLE_PK,
  TABLE_SK,
  albumItemSk,
  albumObjectSk,
  albumUsageSk,
  getItem,
  queryPage,
  teamPk,
  transactWrite,
} from '../../lib/dynamo/index.js';
import { TABLE_NAME } from '../../lib/names.js';
import { isOwnedUploadKey } from '../../lib/upload-keys.js';
import { deleteObject, objectInfo } from './media-store.js';

/** Items in one album page. A phone grid shows about this many before scrolling twice. */
export const ALBUM_PAGE_SIZE = 60;

/** How many times an add or remove retries when another one changed the usage row first. */
const USAGE_ATTEMPTS = 3;

/** Stored album item row. */
type AlbumItemRow = AlbumItem & { PK: string; SK: string };

/** Stored usage row. */
type UsageRow = { bytes?: number; version?: number };

/** Path ids look like the ones {@link newItemId} makes. */
const ITEM_ID_PATTERN = /^[0-9a-z]{9}-[0-9a-f-]{36}$/u;

/**
 * A new item id. The time comes first, so sort-key order is upload order.
 *
 * @param nowMs - Current time in epoch milliseconds.
 * @returns An id no other item uses.
 */
const newItemId = (nowMs: number): string => `${nowMs.toString(36).padStart(9, '0')}-${randomUUID()}`;

/**
 * Drops the table keys from a stored row.
 *
 * @param row - The stored item.
 * @returns The wire item.
 */
const toWire = ({ PK: _pk, SK: _sk, ...item }: AlbumItemRow): AlbumItem => item;

/**
 * The album's current usage and the version an update must match.
 *
 * @param teamId - The team.
 * @returns Bytes used and the stored version, `undefined` before the first add.
 */
const readUsage = async (teamId: string): Promise<{ bytes: number; version: number | undefined }> => {
  const row = await getItem<UsageRow>(teamPk(teamId), albumUsageSk());
  return { bytes: row?.bytes ?? 0, version: row === undefined ? undefined : (row.version ?? 0) };
};

/**
 * A transaction entry that writes new usage, only if nobody changed it since it was read.
 *
 * @param teamId - The team.
 * @param bytes - The new total.
 * @param version - The version that was read, or `undefined` when there was no row.
 * @returns The `Put` entry.
 */
const usagePut = (
  teamId: string,
  bytes: number,
  version: number | undefined,
): {
  Put: {
    TableName: string;
    Item: Record<string, unknown>;
    ConditionExpression: string;
    ExpressionAttributeNames: Record<string, string>;
    ExpressionAttributeValues?: Record<string, unknown>;
  };
} => ({
  Put: {
    TableName: TABLE_NAME,
    Item: { [TABLE_PK]: teamPk(teamId), [TABLE_SK]: albumUsageSk(), bytes, version: (version ?? 0) + 1 },
    ...(version === undefined
      ? { ConditionExpression: 'attribute_not_exists(#pk)', ExpressionAttributeNames: { '#pk': TABLE_PK } }
      : {
          ConditionExpression: '#version = :version',
          ExpressionAttributeNames: { '#version': 'version' },
          ExpressionAttributeValues: { ':version': version },
        }),
  },
});

/**
 * Whether a write failed because a condition no longer held.
 *
 * @param error - The thrown value.
 * @returns `true` for a lost race, which is worth retrying.
 */
const lostRace = (error: unknown): boolean =>
  error instanceof Error &&
  (error.name === 'TransactionCanceledException' || error.name === 'ConditionalCheckFailedException');

/**
 * Runs a usage-changing write, retrying when another write changed usage first.
 *
 * @param attempt - Reads usage and writes; throws a lost race to try again.
 * @returns What the write returned.
 * @throws `album_busy` when every attempt lost.
 */
const withUsageRetry = async <T>(attempt: () => Promise<T>): Promise<T> => {
  for (let tries = 1; ; tries += 1) {
    try {
      return await attempt();
    } catch (error) {
      if (!lostRace(error)) throw error;
      if (tries >= USAGE_ATTEMPTS) throw new Error('album_busy');
    }
  }
};

/**
 * Throws the plan's problem with a file, if it has one.
 *
 * @param limits - The team's plan limits.
 * @param usedBytes - Bytes the album holds now.
 * @param upload - The file.
 */
const assertFits = (
  limits: PlanLimits,
  usedBytes: number,
  upload: { contentType: string; bytes: number; durationSeconds?: number },
): void => {
  const problem = albumUploadProblem(limits, usedBytes, upload);
  if (problem !== undefined) throw new Error(problem);
};

/**
 * Checks a planned upload against the plan before the app sends the file.
 *
 * {@link addAlbumItem} checks again with the stored size, so this only spares
 * a person uploading a file that would be refused.
 *
 * @param teamId - The team.
 * @param limits - The team's plan limits.
 * @param upload - Declared type, size, and video length.
 */
export const assertAlbumUploadAllowed = async (
  teamId: string,
  limits: PlanLimits,
  upload: { contentType: string; bytes: number; durationSeconds?: number },
): Promise<void> => {
  assertFits(limits, (await readUsage(teamId)).bytes, upload);
};

/**
 * One page of the album, newest first, and the storage it uses.
 *
 * @param teamId - The team.
 * @param cursor - The cursor from the previous page.
 * @returns Items, usage, and the next cursor when more remain.
 */
export const listAlbum = async (teamId: string, cursor?: string): Promise<AlbumPage> => {
  const [page, usage] = await Promise.all([
    queryPage<AlbumItemRow>(
      {
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
        ExpressionAttributeNames: { '#pk': TABLE_PK, '#sk': TABLE_SK },
        ExpressionAttributeValues: { ':pk': teamPk(teamId), ':skPrefix': ALBUM_SK_PREFIX },
        ScanIndexForward: false,
      },
      { limit: ALBUM_PAGE_SIZE, ...(cursor !== undefined ? { cursor } : {}) },
    ),
    readUsage(teamId),
  ]);
  return {
    teamId,
    items: page.items.map(toWire),
    usedBytes: usage.bytes,
    ...(page.cursor !== undefined ? { cursor: page.cursor } : {}),
  };
};

/**
 * Adds an uploaded file to the album.
 *
 * The size and type come from the stored object, not the request, so a file
 * swapped after signing still counts at its real size.
 *
 * @param input - Team, uploader, plan limits, and the request body.
 * @returns The new item.
 * @throws `invalid_object_key` for a key the caller did not upload,
 *   `upload_not_found` before the file arrives, `unsupported_type`,
 *   `already_in_album`, a plan problem, or `album_busy`.
 */
export const addAlbumItem = async (input: {
  teamId: string;
  userId: string;
  limits: PlanLimits;
  body: AddAlbumItemBody;
  nowMs?: number;
}): Promise<AlbumItem> => {
  const { teamId, userId, limits, body } = input;
  if (!isOwnedUploadKey(userId, body.objectKey)) throw new Error('invalid_object_key');
  const stored = await objectInfo(body.objectKey);
  if (stored === undefined || stored.bytes === 0) throw new Error('upload_not_found');
  const type = albumContentTypeSchema.safeParse(stored.contentType);
  if (!type.success) throw new Error('unsupported_type');
  const contentType: AlbumContentType = type.data;
  const video = isAlbumVideo(contentType);
  if ((await getItem(teamPk(teamId), albumObjectSk(body.objectKey))) !== undefined) {
    throw new Error('already_in_album');
  }

  const nowMs = input.nowMs ?? Date.now();
  const item: AlbumItem = {
    itemId: newItemId(nowMs),
    teamId,
    objectKey: body.objectKey,
    kind: video ? 'video' : 'photo',
    contentType,
    bytes: stored.bytes,
    ...(video && body.durationSeconds !== undefined ? { durationSeconds: body.durationSeconds } : {}),
    ...(body.width !== undefined ? { width: body.width } : {}),
    ...(body.height !== undefined ? { height: body.height } : {}),
    uploadedBy: userId,
    createdAt: new Date(nowMs).toISOString(),
  };

  return withUsageRetry(async () => {
    const usage = await readUsage(teamId);
    assertFits(limits, usage.bytes, {
      contentType,
      bytes: stored.bytes,
      ...(item.durationSeconds !== undefined ? { durationSeconds: item.durationSeconds } : {}),
    });
    await transactWrite([
      {
        Put: {
          TableName: TABLE_NAME,
          Item: { [TABLE_PK]: teamPk(teamId), [TABLE_SK]: albumItemSk(item.itemId), ...item },
          ConditionExpression: 'attribute_not_exists(#pk)',
          ExpressionAttributeNames: { '#pk': TABLE_PK },
        },
      },
      {
        Put: {
          TableName: TABLE_NAME,
          Item: {
            [TABLE_PK]: teamPk(teamId),
            [TABLE_SK]: albumObjectSk(body.objectKey),
            itemId: item.itemId,
          },
          ConditionExpression: 'attribute_not_exists(#pk)',
          ExpressionAttributeNames: { '#pk': TABLE_PK },
        },
      },
      usagePut(teamId, usage.bytes + stored.bytes, usage.version),
    ]);
    return item;
  });
};

/**
 * Removes an item from the album, frees its storage, and deletes the file.
 *
 * @param teamId - The team.
 * @param itemId - The item from the path.
 * @throws `album_item_not_found` when the album has no such item, or `album_busy`.
 */
export const removeAlbumItem = async (teamId: string, itemId: string): Promise<void> => {
  if (!ITEM_ID_PATTERN.test(itemId)) throw new Error('album_item_not_found');

  // A second remove of the same item finds it gone on retry, so usage drops once.
  const row = await withUsageRetry(async () => {
    const found = await getItem<AlbumItemRow>(teamPk(teamId), albumItemSk(itemId));
    if (found === undefined) throw new Error('album_item_not_found');
    const usage = await readUsage(teamId);
    await transactWrite([
      {
        Delete: {
          TableName: TABLE_NAME,
          Key: { [TABLE_PK]: teamPk(teamId), [TABLE_SK]: albumItemSk(itemId) },
          ConditionExpression: 'attribute_exists(#pk)',
          ExpressionAttributeNames: { '#pk': TABLE_PK },
        },
      },
      {
        Delete: {
          TableName: TABLE_NAME,
          Key: { [TABLE_PK]: teamPk(teamId), [TABLE_SK]: albumObjectSk(found.objectKey) },
        },
      },
      usagePut(teamId, Math.max(0, usage.bytes - found.bytes), usage.version),
    ]);
    return found;
  });
  await deleteObject(row.objectKey);
};
