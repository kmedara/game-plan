/**
 * Exact-email adult search route.
 */

import { searchUsersQuerySchema } from '@gameplan/schemas';
import { requireUser } from '../../../lib/auth/index.js';
import { json } from '../../../lib/http.js';
import { route, withQueryValidation } from '../../../lib/pipeline.js';
import { searchAdultByEmail } from '../chat-store.js';
import { withChatErrors } from './errors.js';

/**
 * Handles `GET /chat/users/search?email=`.
 *
 * @param event - The HTTP API event.
 * @returns The matching adult profile, or `user_not_found`.
 */
export const handleSearchUsers = route(
  withChatErrors(),
  withQueryValidation(searchUsersQuerySchema),
  requireUser(),
  async ({ query }) => {
    const user = await searchAdultByEmail(query.email);
    return json(200, { user });
  },
);
