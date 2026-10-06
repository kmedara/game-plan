/**
 * `GET /teams/:teamId` — load one team the caller belongs to.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { json } from '../../../lib/http.js';import { requireUser } from '../../../lib/auth/index.js';

import { requireMembership, requireTeam, toTeamSummary } from '../team-store.js';

import { withTeamsErrors } from './errors.js';

/**
 * Handles `GET /teams/:teamId`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @returns The team record and the caller's role.
 */
export const handleGetTeam = (
  event: APIGatewayProxyEventV2,
  teamId: string,
): Promise<APIGatewayProxyStructuredResultV2> =>
  withTeamsErrors(async () => {
    const user = await requireUser(event);
    const team = await requireTeam(teamId);
    const member = await requireMembership(teamId, user.userId);
    return json(200, toTeamSummary(team, member.role));
  });
