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
import { assignMemberRole, getMembership, listMembers } from "../team-store.js";
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
 * Handles `GET /teams/:teamId/members/:userId`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @param memberUserId - The roster member to view.
 * @returns Profile fields teammates can see on this team.
 */
export const handleGetMember = route(
  ["teamId", "memberUserId"],
  withTeamsErrors(),
  requireUser(),
  requireMembership(),
  async ({ teamId, memberUserId }) => {
    const member = await getMembership(teamId, memberUserId);
    if (member === undefined) throw new Error("member_not_found");

    const profile = await getProfile(memberUserId);
    return json(200, {
      userId: member.userId,
      role: member.role,
      joinedAt: member.joinedAt,
      ...(member.positions !== undefined && member.positions.length > 0
        ? { positions: member.positions }
        : {}),
      ...(profile !== undefined
        ? {
            displayName: profile.displayName,
            email: profile.email,
            accountKind: profile.accountKind,
            ...(profile.photoKey !== undefined ? { photoKey: profile.photoKey } : {}),
            ...(profile.phoneNumber !== undefined
              ? { phoneNumber: profile.phoneNumber }
              : {}),
          }
        : {}),
    });
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
