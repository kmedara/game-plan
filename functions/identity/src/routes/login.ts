/**
 * `POST /identity/login`
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import {
  getIdentityProvider,
  getProfile,
  REFRESH_DELIVERY_HEADER,
  toUserProfile,
  wantsBodyRefreshToken,
} from '../../../lib/auth/index.js';
import { loginBodySchema } from '@gameplan/schemas';
import { headerOf, json, withBodyValidation } from '../../../lib/http.js';
import { mapError, sessionResponse } from './session.js';

/**
 * Handles `POST /identity/login`.
 *
 * @param event - The HTTP API event.
 * @returns A session response or an error.
 */
export const handleLogin = (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> =>
  withBodyValidation(loginBodySchema, async (event, body) => {
    try {
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
    } catch (error) {
      return mapError(error) ?? json(500, { error: 'internal_error' });
    }
  })(event);
