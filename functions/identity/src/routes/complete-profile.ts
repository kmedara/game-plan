/**
 * `POST /identity/profile/complete` — finish birthday after social Hosted UI sign-in.
 */

import { completeProfileBodySchema } from '@gameplan/schemas';
import { getProfile, putProfile, toUserProfile, verifyAuthHeader } from '../../../lib/auth/index.js';
import { accountKindFromBirthday } from '../../../lib/minor-chat.js';
import { badRequest, headerOf, json } from '../../../lib/http.js';
import { route, withBodyValidation } from '../../../lib/pipeline.js';
import { withIdentityErrors } from './session.js';

/**
 * Handles `POST /identity/profile/complete`.
 *
 * @param event - The HTTP API event.
 * @returns The completed profile, or an error.
 */
export const handleCompleteProfile = route(
  withIdentityErrors(),
  withBodyValidation(completeProfileBodySchema),
  async ({ event, body }) => {
    let accountKind: 'adult' | 'minor';
    try {
      accountKind = accountKindFromBirthday(body.birthday);
    } catch {
      return badRequest('invalid_birthday');
    }

    const auth = await verifyAuthHeader(headerOf(event, 'authorization'));
    const existing = await getProfile(auth.userId);
    const email = auth.email ?? existing?.email;
    if (email === undefined) return badRequest('email_required');

    const displayName =
      body.displayName?.trim() || existing?.displayName || email.split('@')[0] || 'Player';

    const profile = await putProfile({
      userId: auth.userId,
      email,
      displayName,
      accountKind,
      birthday: body.birthday,
      createdAt: existing?.createdAt,
      passwordHash: existing?.passwordHash,
      photoKey: existing?.photoKey,
    });
    return json(200, toUserProfile(profile));
  },
);
