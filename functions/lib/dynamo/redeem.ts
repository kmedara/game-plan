/**
 * One-time rows: a code or ticket that works for a single call.
 */

import { DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { TABLE_NAME } from '../names.js';
import { getDocClient } from './client.js';
import { TABLE_PK, TABLE_SK } from './keys.js';

/**
 * Deletes a one-time row and returns what it held.
 *
 * A second call finds nothing. A row whose time-to-live is already due is
 * deleted and rejected, because DynamoDB TTL removal can lag.
 *
 * @param pk - The partition key.
 * @param sk - The sort key.
 * @returns The row's attributes, or `undefined` when it is gone or expired.
 */
export const redeemOnce = async (
  pk: string,
  sk: string,
): Promise<Record<string, unknown> | undefined> => {
  try {
    const result = await getDocClient().send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { [TABLE_PK]: pk, [TABLE_SK]: sk },
        ConditionExpression: 'attribute_exists(#pk)',
        ExpressionAttributeNames: { '#pk': TABLE_PK },
        ReturnValues: 'ALL_OLD',
      }),
    );
    const attributes = result.Attributes;
    if (attributes === undefined) return undefined;
    const ttl = attributes.ttl;
    if (typeof ttl === 'number' && ttl <= Math.floor(Date.now() / 1000)) return undefined;
    return attributes;
  } catch (error) {
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
      return undefined;
    }
    throw error;
  }
};
