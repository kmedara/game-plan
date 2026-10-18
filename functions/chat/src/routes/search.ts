/**
 * Exact-email adult search route.
 */

import { searchUsersQuerySchema } from '@gameplan/schemas';
import { findProfileByEmail, requireUser, toUserProfile } from '../../../lib/auth/index.js';
import { json } from '../../../lib/http.js';
import { route, withQueryValidation } from '../../../lib/pipeline.js';
import { matchesUserSearchPolicy } from '@gameplan/rules';
import { withChatErrors } from './errors.js';

/**
 * Handles `GET /chat/users/search?email=`.
 *
 * Minors and missing emails look the same to the caller (`user_not_found`).
 * Phone numbers stay off this response; they are for teammates only.
 *
 * @param event - The HTTP API event.
 * @returns The matching adult profile, or `user_not_found`.
 */
export const handleSearchUsers = route(
  'GET',
  '/chat/users/search',
  withChatErrors(),
  requireUser(),
  withQueryValidation(searchUsersQuerySchema),
  async ({ query }) => {
    const profile = await findProfileByEmail(query.email.trim().toLowerCase());
    if (profile === undefined || !matchesUserSearchPolicy(profile.accountKind)) {
      throw new Error('user_not_found');
    }
    const { phoneNumber: _phone, ...user } = toUserProfile(profile);
    return json(200, { user });
  },
);
