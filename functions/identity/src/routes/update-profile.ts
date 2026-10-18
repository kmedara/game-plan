/**
 * `PATCH /identity/profile` — update the caller's photo and/or phone number.
 */

import { toE164Phone, updateProfileBodySchema } from '@gameplan/schemas';
import { getProfile, putProfile, requireUser, toUserProfile } from '../../../lib/auth/index.js';
import { json } from '../../../lib/http.js';
import { route, withBodyValidation } from '../../../lib/pipeline.js';
import { withIdentityErrors } from './session.js';

/**
 * Returns whether an object key is an upload owned by this user.
 *
 * @param userId - The caller's user id.
 * @param photoKey - The media object key from a presigned upload.
 * @returns `true` when the key sits under that user's upload prefix.
 */
const ownsPhotoKey = (userId: string, photoKey: string): boolean => {
  const prefix = `uploads/${userId}/`;
  return (
    photoKey.startsWith(prefix) &&
    photoKey.length > prefix.length &&
    !photoKey.includes('..') &&
    !photoKey.includes('\\')
  );
};

/**
 * Handles `PATCH /identity/profile`.
 *
 * @param event - The HTTP API event.
 * @returns The updated profile.
 */
export const handleUpdateProfile = route(
  'PATCH',
  '/identity/profile',
  withIdentityErrors(),
  requireUser(),
  withBodyValidation(updateProfileBodySchema),
  async ({ user, body }) => {
    if (body.photoKey === undefined && body.phoneNumber === undefined) {
      throw new Error('invalid_body');
    }
    if (body.photoKey !== undefined && body.photoKey !== null && !ownsPhotoKey(user.userId, body.photoKey)) {
      throw new Error('invalid_photo_key');
    }

    const existing = await getProfile(user.userId);
    if (existing === undefined) throw new Error('profile_not_found');

    const profile = await putProfile({
      userId: existing.userId,
      email: existing.email,
      displayName: existing.displayName,
      accountKind: existing.accountKind,
      birthday: existing.birthday,
      createdAt: existing.createdAt,
      passwordHash: existing.passwordHash,
      photoKey: body.photoKey !== undefined ? body.photoKey : (existing.photoKey ?? null),
      phoneNumber:
        body.phoneNumber === undefined
          ? (existing.phoneNumber ?? null)
          : body.phoneNumber === null
            ? null
            : toE164Phone(body.phoneNumber),
    });
    return json(200, toUserProfile(profile));
  },
);
