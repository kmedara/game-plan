/**
 * DynamoDB helpers for WebSocket connection rows under the user partition.
 */

import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  CONNECTION_SK_PREFIX,
  CONNECTION_TTL_SECONDS,
  GSI_CONNECTION_ID,
  TABLE_PK,
  TABLE_SK,
  connectionSk,
  deleteItem,
  getDocClient,
  getItem,
  putItem,
  queryBySkPrefix,
  userPk,
} from '../../lib/dynamo/index.js';
import { CONNECTION_INDEX, TABLE_NAME } from '../../lib/names.js';

/** Socket connection under `USER#id` / `CONN#connectionId`. */
export type ConnectionItem = {
  PK: string;
  SK: string;
  connectionId: string;
  userId: string;
  connectedAt: string;
  ttl: number;
};

/**
 * Writes a connection row with a time-to-live so a dropped phone expires.
 *
 * @param userId - The authenticated user id.
 * @param connectionId - The Amazon API Gateway WebSocket connection id.
 * @returns The stored connection item.
 */
export const putConnection = async (
  userId: string,
  connectionId: string,
): Promise<ConnectionItem> => {
  const connectedAt = new Date().toISOString();
  const item: ConnectionItem = {
    [TABLE_PK]: userPk(userId),
    [TABLE_SK]: connectionSk(connectionId),
    connectionId,
    userId,
    connectedAt,
    ttl: Math.floor(Date.now() / 1000) + CONNECTION_TTL_SECONDS,
  };
  await putItem(item);
  return item;
};

/**
 * Deletes a connection row by user and connection id.
 *
 * @param userId - The user who owned the connection.
 * @param connectionId - The WebSocket connection id.
 */
export const deleteConnection = async (
  userId: string,
  connectionId: string,
): Promise<void> => {
  await deleteItem(userPk(userId), connectionSk(connectionId));
};

/**
 * Lists open socket connections for a user.
 *
 * @param userId - The user id.
 * @returns Connection rows under that user partition.
 */
export const listConnectionsForUser = async (
  userId: string,
): Promise<ConnectionItem[]> =>
  queryBySkPrefix<ConnectionItem>(userPk(userId), CONNECTION_SK_PREFIX);

/**
 * Finds a connection row from the connection-id Global Secondary Index (GSI).
 *
 * `$disconnect` only has the connection id, so the lookup starts on the index
 * and then loads the base item when the index projects keys only.
 *
 * @param connectionId - The WebSocket connection id.
 * @returns The connection item, or `undefined` when missing.
 */
export const findConnectionById = async (
  connectionId: string,
): Promise<ConnectionItem | undefined> => {
  const result = await getDocClient().send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: CONNECTION_INDEX,
      KeyConditionExpression: '#connectionId = :connectionId',
      ExpressionAttributeNames: { '#connectionId': GSI_CONNECTION_ID },
      ExpressionAttributeValues: { ':connectionId': connectionId },
      Limit: 1,
    }),
  );
  const key = result.Items?.[0] as { PK?: string; SK?: string } | undefined;
  if (key?.PK === undefined || key.SK === undefined) return undefined;
  return getItem<ConnectionItem>(key.PK, key.SK);
};
