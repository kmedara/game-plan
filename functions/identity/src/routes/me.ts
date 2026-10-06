/**
 * `GET /identity/me`
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import {
  getProfile,
  isAuthDisabled,
  toUserProfile,
  verifyAuthHeader,
} from '../../../lib/auth/index.js';
import { headerOf, json, unauthorized } from '../../../lib/http.js';
import { pendingProfile } from './oauth.js';
import { issueSeedSession } from './seed-session.js';
import { mapError } from './session.js';

/**
 * Handles `GET /identity/me`.
 *
 * @param event - The HTTP API event.
 * @returns The caller's profile or `401`.
 */
export const handleMe = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> => {
  try {
    if (isAuthDisabled()) {
      const session = await issueSeedSession();
      return json(200, session.user);
    }

    const auth = await verifyAuthHeader(headerOf(event, 'authorization'));
    const profile = await getProfile(auth.userId);
    if (profile === undefined) {
      return json(200, pendingProfile(auth.userId, auth.email, undefined));
    }
    return json(200, toUserProfile(profile));
  } catch (error) {
    return mapError(error) ?? unauthorized();
  }
};
