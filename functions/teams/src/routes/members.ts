/**
 * Roster routes: list members and assign roles.
 */

import { assignRoleBodySchema } from "@gameplan/schemas";
import { getProfile, toUserProfile } from "../../../lib/auth/index.js";
import {
  requireMembership,
  requirePermission,
  requireUser,
} from "../../../lib/guards.js";
import { json } from "../../../lib/http.js";
import { route, withBodyValidation } from "../../../lib/pipeline.js";
import { assignMemberRole, listMembers } from "../team-store.js";
import { withTeamsErrors } from "./errors.js";

/**
 * Handles `GET /teams/:teamId/members`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @returns The roster with basic profile fields when available.
 */
export const handleListMembers = route(
  ["teamId"],
  withTeamsErrors(),
  requireUser(),
  requireMembership(),
  async ({ teamId }) => {
    const members = await listMembers(teamId);
    const enriched = await Promise.all(
      members.map(async (member) => {
        const profile = await getProfile(member.userId);
        return {
          userId: member.userId,
          role: member.role,
          joinedAt: member.joinedAt,
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
    return json(200, { members: enriched });
  },
);

/**
 * Handles `PATCH /teams/:teamId/members/:userId`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @param memberUserId - The roster member whose role changes.
 * @returns The updated membership.
 */
export const handleAssignRole = route(
  ["teamId", "memberUserId"],
  withTeamsErrors(),
  withBodyValidation(assignRoleBodySchema),
  requireUser(),
  requirePermission("assign_roles"),
  async ({ teamId, memberUserId, body }) => {
    const member = await assignMemberRole(teamId, memberUserId, body.role);
    const profile = await getProfile(member.userId);
    return json(200, {
      userId: member.userId,
      role: member.role,
      joinedAt: member.joinedAt,
      ...(profile !== undefined ? { user: toUserProfile(profile) } : {}),
    });
  },
);
