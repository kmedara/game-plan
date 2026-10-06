/**
 * `POST /teams` — create a team and its default chat.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { createTeamBodySchema } from '@gameplan/schemas';
import { requireUser } from '../../../lib/auth/index.js';
import { json, withBodyValidation, withErrors } from '../../../lib/http.js';
import { createTeam, toTeamSummary } from '../team-store.js';
import { mapTeamsError } from './errors.js';

/**
 * Handles `POST /teams`.
 *
 * @param event - The HTTP API event.
 * @returns The created team or an error.
 */
export const handleCreateTeam = (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> =>
  withErrors(
    () =>
      withBodyValidation(createTeamBodySchema, async (event, body) => {
        const user = await requireUser(event);
        const team = await createTeam({
          userId: user.userId,
          name: body.name,
          timeZone: body.timeZone,
        });
        return json(201, toTeamSummary(team, 'team_admin'));
      })(event),
    mapTeamsError,
  );
