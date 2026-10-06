/**
 * `GET /teams` — list teams for the caller.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { json } from '../../../lib/http.js';import { requireUser } from '../../../lib/auth/index.js';

import { listUserTeams, toTeamSummary } from '../team-store.js';

import { withTeamsErrors } from './errors.js';

/**
 * Handles `GET /teams`.
 *
 * @param event - The HTTP API event.
 * @returns The caller's team list.
 */
export const handleListTeams = (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> =>
  withTeamsErrors(async () => {
    const user = await requireUser(event);
    const teams = await listUserTeams(user.userId);
    return json(200, {
      teams: teams.map(({ team, role }) => toTeamSummary(team, role)),
    });
  });
