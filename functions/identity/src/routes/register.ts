/**
 * `POST /identity/register`
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import {
  getIdentityProvider,
  getProfile,
  putProfile,
  REFRESH_DELIVERY_HEADER,
  toUserProfile,
  wantsBodyRefreshToken,
  type UserProfileItem,
} from '../../../lib/auth/index.js';
import { registerBodySchema, type UserProfile } from '@gameplan/schemas';
import { badRequest, headerOf, json, withBodyValidation } from '../../../lib/http.js';
import { accountKindFromBirthday } from '../../../lib/minor-chat.js';
import { mapError, sessionResponse } from './session.js';

/**
 * Ensures a profile row exists after Cognito register (local already wrote one).
 *
 * @param userId - The new user id.
 * @param email - The account email.
 * @param displayName - The display name from registration.
 * @param accountKind - Adult or minor.
 * @param birthday - Calendar date of birth.
 * @returns The profile item.
 */
const ensureProfile = async (
  userId: string,
  email: string,
  displayName: string,
  accountKind: UserProfile['accountKind'],
  birthday: string,
): Promise<UserProfileItem> => {
  const existing = await getProfile(userId);
  if (existing !== undefined) return existing;
  return putProfile({ userId, email, displayName, accountKind, birthday });
};

/**
 * Handles `POST /identity/register`.
 *
 * @param event - The HTTP API event.
 * @returns A session response or an error.
 */
export const handleRegister = (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> =>
  withBodyValidation(registerBodySchema, async (event, body) => {
    let accountKind: UserProfile['accountKind'];
    try {
      accountKind = accountKindFromBirthday(body.birthday);
    } catch {
      return badRequest('invalid_birthday');
    }

    try {
      const tokens = await getIdentityProvider().register({
        email: body.email,
        password: body.password,
        displayName: body.displayName,
        accountKind,
      });
      const profile = await ensureProfile(
        tokens.userId,
        tokens.email,
        body.displayName,
        accountKind,
        body.birthday,
      );
      return sessionResponse(
        201,
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
