/**
 * `POST /identity/refresh`
 */

import { refreshBodySchema } from '@gameplan/schemas';
import {
  getIdentityProvider,
  getProfile,
  REFRESH_COOKIE,
  REFRESH_DELIVERY_HEADER,
  toUserProfile,
  wantsBodyRefreshToken,
} from '../../../lib/auth/index.js';
import { headerOf, readCookie, unauthorized } from '../../../lib/http.js';
import { route, withBodyValidation } from '../../../lib/pipeline.js';
import { pendingProfile } from './oauth.js';
import { sessionResponse, withIdentityErrors } from './session.js';

/**
 * Refreshes a session from a body token or the refresh cookie.
 *
 * Tokens come back in JSON only when the caller sent the refresh token in the
 * body, which only the Expo app can do. A website refresh rides on the HttpOnly
 * cookie, so script on the page cannot ask for the tokens in the response.
 *
 * @param event - The HTTP API event.
 * @returns A session response or an error.
 */
export const handleRefresh = route(
  'POST',
  '/identity/refresh',
  withIdentityErrors(),
  withBodyValidation(refreshBodySchema),
  async ({ event, body }) => {
    const fromBody = body.refreshToken !== undefined;
    const refreshToken = body.refreshToken ?? readCookie(event, REFRESH_COOKIE);
    if (refreshToken === undefined || refreshToken.length === 0) {
      return unauthorized('invalid_token');
    }

    const tokens = await getIdentityProvider().refresh(refreshToken);
    const profile = await getProfile(tokens.userId);
    const user =
      profile === undefined
        ? pendingProfile(tokens.userId, tokens.email, undefined)
        : toUserProfile(profile);
    return sessionResponse(
      200,
      tokens.accessToken,
      tokens.expiresIn,
      user,
      tokens.refreshToken,
      fromBody && wantsBodyRefreshToken(headerOf(event, REFRESH_DELIVERY_HEADER)),
    );
  },
);
