/**
 * `POST /identity/profile/complete` — finish birthday and first and last name.
 */

import { completeProfileBodySchema } from '@gameplan/schemas';
import {
  getProfile,
  profileNeedsCompletion,
  putProfile,
  requireUser,
  toUserProfile,
} from '../../../lib/auth/index.js';
import { accountKindFromBirthday } from '@gameplan/rules';
import { badRequest, json } from '../../../lib/http.js';
import { route, withBodyValidation } from '../../../lib/pipeline.js';
import { withIdentityErrors } from './session.js';

/**
 * Handles `POST /identity/profile/complete`.
 *
 * Social sign-in leaves the birthday unset. Accounts made before names were
 * collected have a birthday but no first or last name. Either finishes here.
 * A stored birthday never changes, since it decides the account kind.
 *
 * @param event - The HTTP API event.
 * @returns The completed profile, or an error.
 */
export const handleCompleteProfile = route(
  'POST',
  '/identity/profile/complete',
  withIdentityErrors(),
  requireUser(),
  withBodyValidation(completeProfileBodySchema),
  async ({ user: auth, body }) => {
    const existing = await getProfile(auth.userId);
    if (existing !== undefined && !profileNeedsCompletion(existing)) {
      throw new Error('profile_already_complete');
    }
    if (
      existing?.birthday !== undefined &&
      body.birthday !== undefined &&
      body.birthday !== existing.birthday
    ) {
      throw new Error('birthday_already_set');
    }

    const birthday = existing?.birthday ?? body.birthday;
    if (birthday === undefined) return badRequest('birthday_required');
    let accountKind: 'adult' | 'minor';
    try {
      accountKind = accountKindFromBirthday(birthday);
    } catch {
      return badRequest('invalid_birthday');
    }

    const tokenEmail = auth.email?.trim();
    const storedEmail = existing?.email?.trim();
    const email =
      tokenEmail !== undefined && tokenEmail.length > 0
        ? tokenEmail
        : storedEmail !== undefined && storedEmail.length > 0
          ? storedEmail
          : undefined;
    if (email === undefined) return badRequest('email_required');

    const profile = await putProfile({
      userId: auth.userId,
      email,
      displayName: `${body.firstName} ${body.lastName}`,
      firstName: body.firstName,
      lastName: body.lastName,
      accountKind,
      birthday,
      createdAt: existing?.createdAt,
      passwordHash: existing?.passwordHash,
      photoKey: existing?.photoKey,
      phoneNumber: existing?.phoneNumber,
    });
    return json(200, toUserProfile(profile));
  },
);
