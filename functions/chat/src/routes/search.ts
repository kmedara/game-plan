/**
 * Teammate name search route.
 */

import { searchUsersQuerySchema } from '@gameplan/schemas';
import { requireUser } from '../../../lib/auth/index.js';
import { json } from '../../../lib/http.js';
import { route, withQueryValidation } from '../../../lib/pipeline.js';
import { matchesPersonName } from '@gameplan/rules';
import { listTeammates } from '../chat-store.js';
import { withChatErrors } from './errors.js';

/** Most people one search returns. */
const SEARCH_LIMIT = 20;

/**
 * Handles `GET /chat/users/search?q=`.
 *
 * Only people who share a team with the caller are searched, the same people
 * the caller already sees on a roster. Names come from the roster rows, so a
 * search reads one row per teammate and no profiles.
 *
 * @param event - The HTTP API event.
 * @returns Matching teammates sorted by display name, possibly none.
 */
export const handleSearchUsers = route(
  'GET',
  '/chat/users/search',
  withChatErrors(),
  requireUser(),
  withQueryValidation(searchUsersQuerySchema),
  async ({ user: caller, query }) => {
    const users = (await listTeammates(caller.userId))
      .filter((teammate) => matchesPersonName(query.q, teammate))
      .sort((left, right) => left.displayName.localeCompare(right.displayName))
      .slice(0, SEARCH_LIMIT);
    return json(200, { users });
  },
);
