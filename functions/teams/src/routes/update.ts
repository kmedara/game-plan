/**
 * `PATCH /teams/:teamId` — update the team name, time zone, and location.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { updateTeamBodySchema } from '@gameplan/schemas';
import { badRequest, json, withBodyValidation } from '../../../lib/http.js';
import { requirePermission, requireUser } from '../../../lib/auth/index.js';

import { requireMembership, toTeamSummary, updateTeamSettings } from '../team-store.js';

import { withTeamsErrors } from './errors.js';

/**
 * Handles `PATCH /teams/:teamId`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @returns The updated team summary.
 */
export const handleUpdateTeam = (
  event: APIGatewayProxyEventV2,
  teamId: string,
): Promise<APIGatewayProxyStructuredResultV2> =>
  withTeamsErrors(async () =>
    withBodyValidation(updateTeamBodySchema, async (event, body) => {
      const user = await requireUser(event);
      await requirePermission(user.userId, teamId, 'manage_permissions');
      if (Object.keys(body).length === 0) return badRequest('invalid_body');

      const name = body.name?.trim();
      const timeZone = body.timeZone?.trim();
      if (body.name !== undefined && (name === undefined || name.length === 0)) {
        return badRequest('invalid_body');
      }
      if (body.timeZone !== undefined && (timeZone === undefined || timeZone.length === 0)) {
        return badRequest('invalid_body');
      }

      let location = body.location;
      if (typeof location === 'string') {
        const trimmed = location.trim();
        location = trimmed.length === 0 ? null : trimmed;
      }

      const member = await requireMembership(teamId, user.userId);
      const team = await updateTeamSettings({
        teamId,
        ...(name !== undefined ? { name } : {}),
        ...(timeZone !== undefined ? { timeZone } : {}),
        ...(location !== undefined ? { location } : {}),
      });
      return json(200, toTeamSummary(team, member.role));
    })(event),
  );
