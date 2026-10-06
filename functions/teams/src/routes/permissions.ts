/**
 * Permission-matrix routes for the team admin screen.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { TEAM_ROLES } from '@gameplan/types';
import { updateRolePermissionsBodySchema } from '@gameplan/schemas';
import { json, withBodyValidation } from '../../../lib/http.js';
import { loadRolePermissionMatrix } from '../../../lib/permissions.js';
import { requirePermission, requireUser } from '../../../lib/auth/index.js';

import { requireMembership, updateRolePermissions } from '../team-store.js';

import { withTeamsErrors } from './errors.js';

/**
 * Handles `GET /teams/:teamId/permissions`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @returns The role-permission matrix.
 */
export const handleGetPermissions = (
  event: APIGatewayProxyEventV2,
  teamId: string,
): Promise<APIGatewayProxyStructuredResultV2> =>
  withTeamsErrors(async () => {
    const user = await requireUser(event);
    await requireMembership(teamId, user.userId);
    const matrix = await loadRolePermissionMatrix(teamId);
    return json(200, {
      roles: TEAM_ROLES.map((role) => ({
        role,
        permissions: matrix[role],
      })),
    });
  });

/**
 * Handles `PUT /teams/:teamId/permissions`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @returns The updated matrix.
 */
export const handleUpdatePermissions = (
  event: APIGatewayProxyEventV2,
  teamId: string,
): Promise<APIGatewayProxyStructuredResultV2> =>
  withTeamsErrors(async () =>
    withBodyValidation(updateRolePermissionsBodySchema, async (event, body) => {
      const user = await requireUser(event);
      await requirePermission(user.userId, teamId, 'manage_permissions');

      const matrix = await updateRolePermissions(teamId, body.roles);
      return json(200, {
        roles: TEAM_ROLES.map((role) => ({
          role,
          permissions: matrix[role],
        })),
      });
    })(event),
  );
