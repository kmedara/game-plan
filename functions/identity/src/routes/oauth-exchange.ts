/**
 * `POST /identity/oauth/exchange`
 *
 * Redeems a one-time native handoff code for a session with a body refresh token.
 */

import { oauthExchangeBodySchema } from '@gameplan/schemas';
import {
  getIdentityProvider,
  getProfile,
  toUserProfile,
} from '../../../lib/auth/index.js';
import { redeemOAuthHandoff } from '../../../lib/oauth-handoff.js';
import { json, unauthorized, withCookies } from '../../../lib/http.js';
import { route, withBodyValidation } from '../../../lib/pipeline.js';
import { refreshSetCookie } from '../../../lib/auth/index.js';
import { pendingProfile } from './oauth.js';
import { withIdentityErrors } from './session.js';

/**
 * Exchanges a native OAuth handoff code for access and refresh tokens.
 *
 * @param event - The HTTP API event.
 * @returns A session response including `next`, or an error.
 */
export const handleOAuthExchange = route(
  withIdentityErrors(),
  withBodyValidation(oauthExchangeBodySchema),
  async ({ body }) => {
    const handoff = await redeemOAuthHandoff(body.code);
    if (handoff === undefined) return unauthorized('invalid_token');

    const tokens = await getIdentityProvider().refresh(handoff.refreshToken);
    const profile = await getProfile(tokens.userId);
    const user =
      profile === undefined
        ? pendingProfile(tokens.userId, tokens.email, undefined)
        : toUserProfile(profile);
    const refreshToken = tokens.refreshToken;
    return withCookies(
      json(200, {
        accessToken: tokens.accessToken,
        expiresIn: tokens.expiresIn,
        user,
        refreshToken,
        next: handoff.next,
      }),
      [refreshSetCookie(refreshToken)],
    );
  },
);
