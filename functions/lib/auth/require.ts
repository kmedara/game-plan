/**
 * Route guards shared by area HTTP handlers.
 */

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { AuthUser, TeamPermission } from '@gameplan/types';
import { can } from '../permissions.js';
import { authenticateRequest } from './cognito.js';

/**
 * Authenticates the HTTP request and returns the caller.
 *
 * @param event - The HTTP API event.
 * @returns The authenticated user.
 */
export const requireUser = (event: APIGatewayProxyEventV2): Promise<AuthUser> =>
  authenticateRequest(event);

/**
 * Ensures the caller holds a team permission.
 *
 * @param userId - The caller's user id.
 * @param teamId - The team under test.
 * @param permission - The required permission.
 */
export const requirePermission = async (
  userId: string,
  teamId: string,
  permission: TeamPermission,
): Promise<void> => {
  if (!(await can(userId, teamId, permission))) {
    throw new Error('forbidden');
  }
};
