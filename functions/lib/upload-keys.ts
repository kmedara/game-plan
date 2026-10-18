/**
 * Object keys for files a person uploads through a presigned URL.
 */

import { randomUUID } from 'node:crypto';

/**
 * Where one person's uploads live.
 *
 * @param userId - The uploader.
 * @returns The key prefix, ending in a slash.
 */
export const uploadPrefix = (userId: string): string => `uploads/${userId}/`;

/**
 * A fresh key under the uploader's prefix.
 *
 * @param userId - The uploader.
 * @returns A key no other upload uses.
 */
export const newUploadKey = (userId: string): string => `${uploadPrefix(userId)}${randomUUID()}`;

/**
 * Whether a key from a request is an upload owned by this person.
 *
 * Rejects path tricks, so a key cannot climb out of the prefix.
 *
 * @param userId - The caller.
 * @param key - The object key from the request.
 * @returns `true` when the key is one of the caller's uploads.
 */
export const isOwnedUploadKey = (userId: string, key: string): boolean => {
  const prefix = uploadPrefix(userId);
  return key.startsWith(prefix) && key.length > prefix.length && !key.includes('..') && !key.includes('\\');
};
