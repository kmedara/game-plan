/**
 * Thin DynamoDB access helpers shared by every area Lambda.
 */

import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  type QueryCommandInput,
  type TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { TABLE_NAME } from "../names.js";
import { getDocClient } from "./client.js";
import { TABLE_PK, TABLE_SK } from "./keys.js";

/** Opaque cursor: base64url of the DynamoDB `LastEvaluatedKey`. */
export const encodeCursor = (
  key: Record<string, unknown> | undefined,
): string | undefined =>
  key === undefined
    ? undefined
    : Buffer.from(JSON.stringify(key), "utf8").toString("base64url");

/**
 * Decodes a page cursor produced by {@link encodeCursor}.
 *
 * @param cursor - An opaque cursor string, or `undefined` for the first page.
 * @returns The DynamoDB exclusive start key, or `undefined` when missing or invalid.
 */
export const decodeCursor = (
  cursor?: string,
): Record<string, unknown> | undefined => {
  if (cursor === undefined || cursor.length === 0) return undefined;
  try {
    return JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
  } catch {
    return undefined;
  }
};

/**
 * Loads one item by primary key.
 *
 * @param pk - The partition key value.
 * @param sk - The sort key value.
 * @returns The item, or `undefined` when it does not exist.
 */
export const getItem = async <T extends Record<string, unknown>>(
  pk: string,
  sk: string,
): Promise<T | undefined> => {
  const result = await getDocClient().send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { [TABLE_PK]: pk, [TABLE_SK]: sk },
    }),
  );
  return result.Item as T | undefined;
};

/**
 * Puts one item into the product table.
 *
 * @param item - The full item, including `PK` and `SK`.
 * @param options - Optional condition expression and attribute maps.
 */
export const putItem = async (
  item: Record<string, unknown>,
  options: {
    conditionExpression?: string;
    expressionAttributeNames?: Record<string, string>;
    expressionAttributeValues?: Record<string, unknown>;
  } = {},
): Promise<void> => {
  await getDocClient().send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: item,
      ...(options.conditionExpression !== undefined
        ? { ConditionExpression: options.conditionExpression }
        : {}),
      ...(options.expressionAttributeNames !== undefined
        ? { ExpressionAttributeNames: options.expressionAttributeNames }
        : {}),
      ...(options.expressionAttributeValues !== undefined
        ? { ExpressionAttributeValues: options.expressionAttributeValues }
        : {}),
    }),
  );
};

/**
 * Deletes one item by primary key.
 *
 * @param pk - The partition key value.
 * @param sk - The sort key value.
 */
export const deleteItem = async (pk: string, sk: string): Promise<void> => {
  await getDocClient().send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { [TABLE_PK]: pk, [TABLE_SK]: sk },
    }),
  );
};

/**
 * Runs a `TransactWriteItems` call against the product table.
 *
 * @param items - Transact write items (caller supplies the full Transact items).
 */
export const transactWrite = async (
  items: NonNullable<TransactWriteCommandInput["TransactItems"]>,
): Promise<void> => {
  await getDocClient().send(
    new TransactWriteCommand({
      TransactItems: items,
    }),
  );
};

/** Safety bound so a single call cannot page through an unbounded partition. */
const MAX_QUERY_ALL_PAGES = 50;

/**
 * Pages a query until the partition is exhausted or the page cap is hit.
 *
 * Prefer {@link queryPage} for user-facing lists that can grow without bound.
 *
 * @param input - A query input without `TableName` (filled from config).
 * @returns Every item collected across pages.
 */
export const queryAll = async <T extends Record<string, unknown>>(
  input: Omit<QueryCommandInput, "TableName"> & { TableName?: string },
): Promise<T[]> => {
  const client = getDocClient();
  const items: T[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  let pages = 0;

  do {
    const result = await client.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        ...input,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    items.push(...((result.Items ?? []) as T[]));
    exclusiveStartKey = result.LastEvaluatedKey as
      Record<string, unknown> | undefined;
    pages += 1;
  } while (exclusiveStartKey !== undefined && pages < MAX_QUERY_ALL_PAGES);

  return items;
};

/**
 * Runs a single-page query for lists that need a cursor.
 *
 * @param input - A query input without `TableName` (filled from config).
 * @param options - Page size and optional opaque cursor.
 * @returns The page items and the next cursor when more rows remain.
 */
export const queryPage = async <T extends Record<string, unknown>>(
  input: Omit<
    QueryCommandInput,
    "TableName" | "Limit" | "ExclusiveStartKey"
  > & {
    TableName?: string;
  },
  options: { limit: number; cursor?: string },
): Promise<{ items: T[]; cursor?: string }> => {
  const result = await getDocClient().send(
    new QueryCommand({
      TableName: TABLE_NAME,
      ...input,
      Limit: options.limit,
      ExclusiveStartKey: decodeCursor(options.cursor),
    }),
  );

  return {
    items: (result.Items ?? []) as T[],
    cursor: encodeCursor(
      result.LastEvaluatedKey as Record<string, unknown> | undefined,
    ),
  };
};

/**
 * Queries every item under a partition key.
 *
 * @param pk - The partition key value.
 * @returns Every item in that partition (up to the page cap).
 */
export const queryPartition = async <T extends Record<string, unknown>>(
  pk: string,
): Promise<T[]> =>
  queryAll<T>({
    KeyConditionExpression: "#pk = :pk",
    ExpressionAttributeNames: { "#pk": TABLE_PK },
    ExpressionAttributeValues: { ":pk": pk },
  });

/**
 * Queries items under a partition whose sort key begins with a prefix.
 *
 * @param pk - The partition key value.
 * @param skPrefix - The sort-key prefix.
 * @returns Matching items (up to the page cap).
 */
export const queryBySkPrefix = async <T extends Record<string, unknown>>(
  pk: string,
  skPrefix: string,
): Promise<T[]> =>
  queryAll<T>({
    KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :skPrefix)",
    ExpressionAttributeNames: { "#pk": TABLE_PK, "#sk": TABLE_SK },
    ExpressionAttributeValues: { ":pk": pk, ":skPrefix": skPrefix },
  });

/**
 * Queries items under a partition whose sort key falls in an inclusive range.
 *
 * Used for RSVP month loads where the occurrence instant is embedded in `SK`.
 *
 * @param pk - The partition key value.
 * @param lo - The inclusive low sort key.
 * @param hi - The inclusive high sort key.
 * @returns Matching items (up to the page cap).
 */
export const queryBySkBetween = async <T extends Record<string, unknown>>(
  pk: string,
  lo: string,
  hi: string,
): Promise<T[]> =>
  queryAll<T>({
    KeyConditionExpression: "#pk = :pk AND #sk BETWEEN :lo AND :hi",
    ExpressionAttributeNames: { "#pk": TABLE_PK, "#sk": TABLE_SK },
    ExpressionAttributeValues: { ":pk": pk, ":lo": lo, ":hi": hi },
  });
