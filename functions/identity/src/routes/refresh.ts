/**
 * `POST /identity/refresh`
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { refreshBodySchema } from '@gameplan/schemas';
import {
  getIdentityProvider,
  getProfile,
  isAuthDisabled,
  REFRESH_COOKIE,
  REFRESH_DELIVERY_HEADER,
  toUserProfile,
  wantsBodyRefreshToken,
} from '../../../lib/auth/index.js';
import { headerOf, readCookie, unauthorized } from '../../../lib/http.js';
import { route, withBodyValidation } from '../../../lib/pipeline.js';
import { pendingProfile } from './oauth.js';
import { issueSeedSession } from './seed-session.js';
import { sessionResponse, withIdentityErrors } from './session.js';

/**
 * Refreshes a session from a body token or the refresh cookie.
 *
 * @param event - The HTTP API event.
 * @returns A session response or an error.
 */
const refreshSession = route(
  withIdentityErrors(),
  withBodyValidation(refreshBodySchema),
  async ({ event, body }) => {
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
      wantsBodyRefreshToken(headerOf(event, REFRESH_DELIVERY_HEADER)),
    );
  },
);

/**
 * Handles `POST /identity/refresh`.
 *
 * @param event - The HTTP API event.
 * @returns A session response or an error.
 */
export const handleRefresh = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> => {
  if (isAuthDisabled()) {
    const session = await issueSeedSession();
    return sessionResponse(
      200,
      session.accessToken,
      session.expiresIn,
      session.user,
      session.refreshToken,
      wantsBodyRefreshToken(headerOf(event, REFRESH_DELIVERY_HEADER)),
    );
  }

  return refreshSession(event);
};
