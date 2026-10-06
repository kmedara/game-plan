/**
 * Join-request create, list, approve, and reject routes.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { getProfile, requirePermission, requireUser } from '../../../lib/auth/index.js';
import { approveJoinRequestBodySchema } from '@gameplan/schemas';
import { json, withBodyValidation } from '../../../lib/http.js';
import {
  approveJoinRequest,
  createJoinRequest,
  listJoinRequests,
  rejectJoinRequest,
  requireMembership,
} from '../team-store.js';

import { withTeamsErrors } from './errors.js';

/**
 * Handles `POST /teams/:teamId/join-requests`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @returns The pending join request.
 */
export const handleCreateJoinRequest = (
  event: APIGatewayProxyEventV2,
  teamId: string,
): Promise<APIGatewayProxyStructuredResultV2> =>
  withTeamsErrors(async () => {
    const user = await requireUser(event);
    const request = await createJoinRequest(teamId, user.userId);
    return json(201, {
      requestId: request.requestId,
      teamId,
      userId: request.userId,
      createdAt: request.createdAt,
    });
  });

/**
 * Handles `GET /teams/:teamId/join-requests`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @returns Pending join requests for the team.
 */
export const handleListJoinRequests = (
  event: APIGatewayProxyEventV2,
  teamId: string,
): Promise<APIGatewayProxyStructuredResultV2> =>
  withTeamsErrors(async () => {
    const user = await requireUser(event);
    await requirePermission(user.userId, teamId, 'approve_join_requests');
    await requireMembership(teamId, user.userId);
    const requests = await listJoinRequests(teamId);
    const enriched = await Promise.all(
      requests.map(async (request) => {
        const profile = await getProfile(request.userId);
        return {
          requestId: request.requestId,
          userId: request.userId,
          createdAt: request.createdAt,
          ...(profile !== undefined
            ? {
                displayName: profile.displayName,
                email: profile.email,
                accountKind: profile.accountKind,
              }
            : {}),
        };
      }),
    );
    return json(200, { joinRequests: enriched });
  });

/**
 * Handles `POST /teams/:teamId/join-requests/:requestId/approve`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @param requestId - The join request id from the path.
 * @returns The new membership.
 */
export const handleApproveJoinRequest = (
  event: APIGatewayProxyEventV2,
  teamId: string,
  requestId: string,
): Promise<APIGatewayProxyStructuredResultV2> =>
  withTeamsErrors(async () =>
    withBodyValidation(approveJoinRequestBodySchema, async (event, body) => {
      const user = await requireUser(event);
      await requirePermission(user.userId, teamId, 'approve_join_requests');

      const { team, member } = await approveJoinRequest(teamId, requestId, body.role);
      return json(200, {
        teamId: team.teamId,
        userId: member.userId,
        role: member.role,
        joinedAt: member.joinedAt,
        defaultChatId: team.defaultChatId,
      });
    })(event),
  );

/**
 * Handles `POST /teams/:teamId/join-requests/:requestId/reject`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @param requestId - The join request id from the path.
 * @returns An empty success body.
 */
export const handleRejectJoinRequest = (
  event: APIGatewayProxyEventV2,
  teamId: string,
  requestId: string,
): Promise<APIGatewayProxyStructuredResultV2> =>
  withTeamsErrors(async () => {
    const user = await requireUser(event);
    await requirePermission(user.userId, teamId, 'approve_join_requests');
    await rejectJoinRequest(teamId, requestId);
    return { statusCode: 204 };
  });
