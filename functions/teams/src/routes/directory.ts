/**
 * `GET /teams/directory` — name search for join autocomplete.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { searchTeamDirectoryQuerySchema } from '@gameplan/schemas';
import { json, withErrors, withQueryValidation } from '../../../lib/http.js';
import { requireUser } from '../../../lib/auth/index.js';
import { searchTeamDirectory } from '../team-store.js';
import { mapTeamsError } from './errors.js';

/**
 * Handles `GET /teams/directory?q=&limit=&cursor=`.
 *
 * @param event - The HTTP API event.
 * @returns Matching teams and an optional page cursor.
 */
export const handleSearchDirectory = (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> =>
  withErrors(
    async () =>
      withQueryValidation(searchTeamDirectoryQuerySchema, async (event, query) => {
        await requireUser(event);
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
      })(event),
    mapTeamsError,
  );
