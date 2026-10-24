/**
 * User profile reads and writes for the identity area.
 */

import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { AccountKind } from '@gameplan/types';
import { renameChatMember } from '../chat-member-names.js';
import { renameRosterMember, rosterNames } from '../roster-names.js';
import { getItem, putItem } from '../dynamo/access.js';
import { getDocClient } from '../dynamo/client.js';
import { GSI_EMAIL, TABLE_PK, TABLE_SK, profileSk, userPk } from '../dynamo/keys.js';
import { EMAIL_INDEX, TABLE_NAME } from '../names.js';
import { accountKindForProfile } from '@gameplan/rules';
import type { UserProfileItem } from './identity-provider.js';

/**
 * Replaces a stored account kind with the kind implied by the birthday.
 *
 * @param item - The profile row from DynamoDB.
 * @returns The same row, with `accountKind` derived when a birthday is present.
 */
const withDerivedAccountKind = (item: UserProfileItem): UserProfileItem => {
  const accountKind = accountKindForProfile(item.birthday, item.accountKind);
  if (accountKind === item.accountKind) return item;
  return { ...item, accountKind };
};

/**
 * Loads a user profile by user id.
 *
 * @param userId - The Cognito `sub` or local user id.
 * @returns The profile item, or `undefined` when missing.
 */
export const getProfile = async (userId: string): Promise<UserProfileItem | undefined> => {
  const item = await getItem<UserProfileItem>(userPk(userId), profileSk());
  return item === undefined ? undefined : withDerivedAccountKind(item);
};

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
  const item = await getItem<UserProfileItem>(key.PK, key.SK);
  return item === undefined ? undefined : withDerivedAccountKind(item);
};

/**
 * Writes (or overwrites) a user profile row.
 *
 * Local mode may include `passwordHash`. Cognito mode never stores a password.
 * A changed display name is copied onto the user's private chats, and any
 * name change onto their roster rows.
 *
 * @param input - Profile fields to persist.
 * @returns The stored profile item.
 */
export const putProfile = async (input: {
  userId: string;
  email: string;
  displayName: string;
  firstName?: string;
  lastName?: string;
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
    ...(input.firstName !== undefined ? { firstName: input.firstName.trim() } : {}),
    ...(input.lastName !== undefined ? { lastName: input.lastName.trim() } : {}),
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
  const previous = await getItem<UserProfileItem>(userPk(input.userId), profileSk());
  await putItem(item);
  if (previous !== undefined && previous.displayName !== item.displayName) {
    await renameChatMember(item.userId, item.displayName);
  }
  const names = rosterNames(item);
  if (
    previous !== undefined &&
    names !== undefined &&
    (previous.displayName !== item.displayName ||
      previous.firstName !== item.firstName ||
      previous.lastName !== item.lastName)
  ) {
    await renameRosterMember(item.userId, names);
  }
  return item;
};
