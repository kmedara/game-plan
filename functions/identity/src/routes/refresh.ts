/**
 * `POST /identity/refresh`
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import {
  getIdentityProvider,
  getProfile,
  isAuthDisabled,
  REFRESH_COOKIE,
  REFRESH_DELIVERY_HEADER,
  toUserProfile,
  wantsBodyRefreshToken,
} from '../../../lib/auth/index.js';
import { refreshBodySchema } from '@gameplan/schemas';
import {
  headerOf,
  json,
  readCookie,
  unauthorized,
  withBodyValidation,
} from '../../../lib/http.js';
import { pendingProfile } from './oauth.js';
import { issueSeedSession } from './seed-session.js';
import { mapError, sessionResponse } from './session.js';

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

  return withBodyValidation(refreshBodySchema, async (event, body) => {
    const refreshToken = body.refreshToken ?? readCookie(event, REFRESH_COOKIE);
    if (refreshToken === undefined || refreshToken.length === 0) {
      return unauthorized('invalid_token');
    }

    try {
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
    } catch (error) {
      return mapError(error) ?? json(500, { error: 'internal_error' });
    }
  })(event);
};
