/**
 * `POST /identity/profile/complete` — finish birthday after social Hosted UI sign-in.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import {
  getProfile,
  putProfile,
  toUserProfile,
  verifyAuthHeader,
} from '../../../lib/auth/index.js';
import { completeProfileBodySchema } from '@gameplan/schemas';
import { accountKindFromBirthday } from '../../../lib/minor-chat.js';
import { badRequest, headerOf, json, withBodyValidation } from '../../../lib/http.js';
import { mapError } from './session.js';

/**
 * Handles `POST /identity/profile/complete`.
 *
 * @param event - The HTTP API event.
 * @returns The completed profile, or an error.
 */
export const handleCompleteProfile = (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> =>
  withBodyValidation(completeProfileBodySchema, async (event, body) => {
    let accountKind: 'adult' | 'minor';
    try {
      accountKind = accountKindFromBirthday(body.birthday);
    } catch {
      return badRequest('invalid_birthday');
    }

    try {
      const auth = await verifyAuthHeader(headerOf(event, 'authorization'));
      const existing = await getProfile(auth.userId);
      const email = auth.email ?? existing?.email;
      if (email === undefined) return badRequest('email_required');

      const displayName =
        body.displayName?.trim() ||
        existing?.displayName ||
        email.split('@')[0] ||
        'Player';

      const profile = await putProfile({
        userId: auth.userId,
        email,
        displayName,
        accountKind,
        birthday: body.birthday,
        createdAt: existing?.createdAt,
        passwordHash: existing?.passwordHash,
      });
      return json(200, toUserProfile(profile));
    } catch (error) {
      return mapError(error) ?? json(500, { error: 'internal_error' });
    }
  })(event);
