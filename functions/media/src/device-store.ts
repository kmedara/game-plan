/**
 * Push device token rows under the user partition.
 */

import type { DevicePlatform } from '@gameplan/types';
import {
  DEVICE_SK_PREFIX,
  TABLE_PK,
  TABLE_SK,
  deleteItem,
  deviceSk,
  putItem,
  queryBySkPrefix,
  userPk,
} from '../../lib/dynamo/index.js';

/** Device token under `USER#id` / `DEVICE#deviceId`. */
export type DeviceItem = {
  PK: string;
  SK: string;
  deviceId: string;
  userId: string;
  token: string;
  platform: DevicePlatform;
  updatedAt: string;
};

/**
 * Upserts a device token for push delivery when no socket is open.
 *
 * @param input - Owner, device id, token, and platform.
 * @returns The stored device item.
 */
export const putDevice = async (input: {
  userId: string;
  deviceId: string;
  token: string;
  platform: DevicePlatform;
}): Promise<DeviceItem> => {
  const item: DeviceItem = {
    [TABLE_PK]: userPk(input.userId),
    [TABLE_SK]: deviceSk(input.deviceId),
    deviceId: input.deviceId,
    userId: input.userId,
    token: input.token,
    platform: input.platform,
    updatedAt: new Date().toISOString(),
  };
  await putItem(item);
  return item;
};

/**
 * Deletes a device token for the caller.
 *
 * @param userId - The owner user id.
 * @param deviceId - The device id from registration.
 */
export const deleteDevice = async (userId: string, deviceId: string): Promise<void> => {
  await deleteItem(userPk(userId), deviceSk(deviceId));
};

/**
 * Lists device tokens for a user.
 *
 * @param userId - The user id.
 * @returns Device rows under that user partition.
 */
export const listDevicesForUser = async (userId: string): Promise<DeviceItem[]> =>
  queryBySkPrefix<DeviceItem>(userPk(userId), DEVICE_SK_PREFIX);
