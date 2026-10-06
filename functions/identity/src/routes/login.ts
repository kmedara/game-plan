/**
 * `POST /identity/login`
 */

import { loginBodySchema } from '@gameplan/schemas';
import {
  getIdentityProvider,
  getProfile,
  REFRESH_DELIVERY_HEADER,
  toUserProfile,
  wantsBodyRefreshToken,
} from '../../../lib/auth/index.js';
import { headerOf, json } from '../../../lib/http.js';
import { route, withBodyValidation } from '../../../lib/pipeline.js';
import { sessionResponse, withIdentityErrors } from './session.js';

/**
 * Handles `POST /identity/login`.
 *
 * @param event - The HTTP API event.
 * @returns A session response or an error.
 */
export const handleLogin = route(
  withIdentityErrors(),
  withBodyValidation(loginBodySchema),
  async ({ event, body }) => {
    const tokens = await getIdentityProvider().login(body);
    const profile = await getProfile(tokens.userId);
    if (profile === undefined) return json(404, { error: 'profile_not_found' });
    return sessionResponse(
      200,
      tokens.accessToken,
      tokens.expiresIn,
      toUserProfile(profile),
      tokens.refreshToken,
      wantsBodyRefreshToken(headerOf(event, REFRESH_DELIVERY_HEADER)),
    );
  },
);
