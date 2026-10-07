/**
 * User profile reads and writes for the identity area.
 */

import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { AccountKind } from '@gameplan/types';
import { getItem, putItem } from '../dynamo/access.js';
import { getDocClient } from '../dynamo/client.js';
import { GSI_EMAIL, TABLE_PK, TABLE_SK, profileSk, userPk } from '../dynamo/keys.js';
import { EMAIL_INDEX, TABLE_NAME } from '../names.js';
import type { UserProfileItem } from './identity-provider.js';

/**
 * Loads a user profile by user id.
 *
 * @param userId - The Cognito `sub` or local user id.
 * @returns The profile item, or `undefined` when missing.
 */
export const getProfile = async (userId: string): Promise<UserProfileItem | undefined> =>
  getItem<UserProfileItem>(userPk(userId), profileSk());

/**
 * Looks up a profile by exact email through the EmailIndex Global Secondary Index (GSI).
 *
 * The index projects keys only, so the base profile row is loaded after the match.
 *
 * @param email - The email address (normalized to lowercase by the caller).
 * @returns The profile item, or `undefined` when no row matches.
 */
export const findProfileByEmail = async (
  email: string,
): Promise<UserProfileItem | undefined> => {
  const result = await getDocClient().send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: EMAIL_INDEX,
      KeyConditionExpression: '#email = :email',
      ExpressionAttributeNames: { '#email': GSI_EMAIL },
      ExpressionAttributeValues: { ':email': email },
      Limit: 1,
    }),
  );
  const key = result.Items?.[0] as { PK?: string; SK?: string } | undefined;
  if (key?.PK === undefined || key.SK === undefined) return undefined;
  return getItem<UserProfileItem>(key.PK, key.SK);
};

/**
 * Writes (or overwrites) a user profile row.
 *
 * Local mode may include `passwordHash`. Cognito mode never stores a password.
 *
 * @param input - Profile fields to persist.
 * @returns The stored profile item.
 */
export const putProfile = async (input: {
  userId: string;
  email: string;
  displayName: string;
  accountKind: AccountKind;
  birthday?: string;
  /** Pass `null` to clear a photo. Omit to leave the row without one. */
  photoKey?: string | null;
  /** Pass `null` to clear a phone. Omit to leave the row without one. */
  phoneNumber?: string | null;
  passwordHash?: string;
  createdAt?: string;
}): Promise<UserProfileItem> => {
  const item: UserProfileItem = {
    [TABLE_PK]: userPk(input.userId),
    [TABLE_SK]: profileSk(),
    userId: input.userId,
    email: input.email.trim().toLowerCase(),
    displayName: input.displayName.trim(),
    accountKind: input.accountKind,
    createdAt: input.createdAt ?? new Date().toISOString(),
    ...(input.birthday !== undefined ? { birthday: input.birthday } : {}),
    ...(input.photoKey !== undefined && input.photoKey !== null
      ? { photoKey: input.photoKey }
      : {}),
    ...(input.phoneNumber !== undefined && input.phoneNumber !== null
      ? { phoneNumber: input.phoneNumber.trim() }
      : {}),
    ...(input.passwordHash !== undefined ? { passwordHash: input.passwordHash } : {}),
  };
  await putItem(item);
  return item;
};
