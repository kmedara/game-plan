/**
 * `POST /identity/register`
 */

import { registerBodySchema, type UserProfile } from '@gameplan/schemas';
import {
  getIdentityProvider,
  getProfile,
  putProfile,
  REFRESH_DELIVERY_HEADER,
  toUserProfile,
  wantsBodyRefreshToken,
  type RegisterResult,
  type UserProfileItem,
} from '../../../lib/auth/index.js';
import { badRequest, headerOf, json } from '../../../lib/http.js';
import { accountKindFromBirthday } from '@gameplan/rules';
import { route, withBodyValidation } from '../../../lib/pipeline.js';
import { sessionResponse, withIdentityErrors } from './session.js';

/**
 * Ensures a profile row exists after Cognito register (local already wrote one).
 *
 * @param input - The new user's id, email, names, account kind, and birthday.
 * @returns The profile item.
 */
const ensureProfile = async (input: {
  userId: string;
  email: string;
  displayName: string;
  firstName: string;
  lastName: string;
  accountKind: UserProfile['accountKind'];
  birthday: string;
}): Promise<UserProfileItem> => {
  const existing = await getProfile(input.userId);
  if (existing !== undefined) return existing;
  return putProfile(input);
};

/**
 * Handles `POST /identity/register`.
 *
 * The display name is `firstName lastName`.
 *
 * @param event - The HTTP API event.
 * @returns A session response or an error.
 */
export const handleRegister = route(
  'POST',
  '/identity/register',
  withIdentityErrors(),
  withBodyValidation(registerBodySchema),
  async ({ event, body }) => {
    let accountKind: UserProfile['accountKind'];
    try {
      accountKind = accountKindFromBirthday(body.birthday);
    } catch {
      return badRequest('invalid_birthday');
    }

    const names = {
      displayName: `${body.firstName} ${body.lastName}`,
      firstName: body.firstName,
      lastName: body.lastName,
    };
    const registered: RegisterResult = await getIdentityProvider().register({
      email: body.email,
      password: body.password,
      ...names,
      accountKind,
    });
    const profileInput = {
      userId: registered.userId,
      email: registered.email,
      ...names,
      accountKind,
      birthday: body.birthday,
    };
    if (registered.status === 'confirmation_required') {
      await ensureProfile(profileInput);
      return json(202, { confirmationRequired: true, email: registered.email });
    }

    const profile = await ensureProfile(profileInput);
    return sessionResponse(
      201,
      registered.accessToken,
      registered.expiresIn,
      toUserProfile(profile),
      registered.refreshToken,
      wantsBodyRefreshToken(headerOf(event, REFRESH_DELIVERY_HEADER)),
    );
  },
);
