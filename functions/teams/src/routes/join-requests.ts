/**
 * Join-request create, list, approve, and reject routes.
 */

import { approveJoinRequestBodySchema } from "@gameplan/schemas";
import { getProfile } from "../../../lib/auth/index.js";
import {
  requireMembership,
  requirePermission,
  requireUser,
} from "../../../lib/guards.js";
import { json } from "../../../lib/http.js";
import { route, withBodyValidation } from "../../../lib/pipeline.js";
import {
  approveJoinRequest,
  createJoinRequest,
  listJoinRequests,
  rejectJoinRequest,
} from "../team-store.js";
import { withTeamsErrors } from "./errors.js";

/**
 * Handles `POST /teams/:teamId/join-requests`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @returns The pending join request.
 */
export const handleCreateJoinRequest = route(
  ["teamId"],
  withTeamsErrors(),
  requireUser(),
  async ({ teamId, user }) => {
    const request = await createJoinRequest(teamId, user.userId);
    return json(201, {
      requestId: request.requestId,
      teamId,
      userId: request.userId,
      createdAt: request.createdAt,
    });
  },
);

/**
 * Handles `GET /teams/:teamId/join-requests`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @returns Pending join requests for the team.
 */
export const handleListJoinRequests = route(
  ["teamId"],
  withTeamsErrors(),
  requireUser(),
  requirePermission("approve_join_requests"),
  requireMembership(),
  async ({ teamId }) => {
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
  },
);

/**
 * Handles `POST /teams/:teamId/join-requests/:requestId/approve`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @param requestId - The join request id from the path.
 * @returns The new membership.
 */
export const handleApproveJoinRequest = route(
  ["teamId", "requestId"],
  withTeamsErrors(),
  withBodyValidation(approveJoinRequestBodySchema),
  requireUser(),
  requirePermission("approve_join_requests"),
  async ({ teamId, requestId, body }) => {
    const { team, member } = await approveJoinRequest(
      teamId,
      requestId,
      body.role,
    );
    return json(200, {
      teamId: team.teamId,
      userId: member.userId,
      role: member.role,
      joinedAt: member.joinedAt,
      defaultChatId: team.defaultChatId,
    });
  },
);

/**
 * Handles `POST /teams/:teamId/join-requests/:requestId/reject`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @param requestId - The join request id from the path.
 * @returns An empty success body.
 */
export const handleRejectJoinRequest = route(
  ["teamId", "requestId"],
  withTeamsErrors(),
  requireUser(),
  requirePermission("approve_join_requests"),
  async ({ teamId, requestId }) => {
    await rejectJoinRequest(teamId, requestId);
    return { statusCode: 204 };
  },
);
