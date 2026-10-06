/**
 * `GET /teams/directory` — name search for join autocomplete.
 */

import { searchTeamDirectoryQuerySchema } from '@gameplan/schemas';
import { requireUser } from '../../../lib/auth/index.js';
import { json } from '../../../lib/http.js';
import { route, withQueryValidation } from '../../../lib/pipeline.js';
import { searchTeamDirectory } from '../team-store.js';
import { withTeamsErrors } from './errors.js';

/**
 * Handles `GET /teams/directory?q=&limit=&cursor=`.
 *
 * @param event - The HTTP API event.
 * @returns Matching teams and an optional page cursor.
 */
export const handleSearchDirectory = route(
  withTeamsErrors(),
  withQueryValidation(searchTeamDirectoryQuerySchema),
  requireUser(),
  async ({ query }) => {
    const page = await searchTeamDirectory(query.q ?? '', {
      limit: query.limit,
      cursor: query.cursor,
    });
    return json(200, {
      teams: page.teams.map((team) => ({
        teamId: team.teamId,
        name: team.name,
        timeZone: team.timeZone,
        ...(team.location !== undefined ? { location: team.location } : {}),
      })),
      ...(page.cursor !== undefined ? { cursor: page.cursor } : {}),
    });
  },
);
