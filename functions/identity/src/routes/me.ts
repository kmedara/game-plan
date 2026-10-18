/**
 * `GET /identity/me`
 */

import { getProfile, toUserProfile, verifyAuthHeader } from '../../../lib/auth/index.js';
import { authorizationOf, json, unauthorized } from '../../../lib/http.js';
import { route } from '../../../lib/pipeline.js';
import { pendingProfile } from './oauth.js';
import { mapError } from './session.js';

/**
 * Handles `GET /identity/me`.
 *
 * @param event - The HTTP API event.
 * @returns The caller's profile or `401`.
 */
export const handleMe = route('GET', '/identity/me', async ({ event }) => {
  try {
    const auth = await verifyAuthHeader(authorizationOf(event));
    const profile = await getProfile(auth.userId);
    if (profile === undefined) {
      return json(200, pendingProfile(auth.userId, auth.email, undefined));
    }
    return json(200, toUserProfile(profile));
  } catch (error) {
    return mapError(error) ?? unauthorized();
  }
});
