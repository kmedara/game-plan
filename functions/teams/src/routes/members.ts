/**
 * Roster routes: list members and assign roles.
 */

import { assignRoleBodySchema } from "@gameplan/schemas";
import { assertCallerCanGrantRoles, highestRole, rolesFromMembership } from "@gameplan/rules";
import { getProfile, toUserProfile } from "../../../lib/auth/index.js";
import { listGuardianIds } from "../../../lib/guardians.js";
import {
  requireMembership,
  requirePermission,
  requireUser,
} from "../../../lib/guards.js";
import { json } from "../../../lib/http.js";
import { route, withBodyValidation } from "../../../lib/pipeline.js";
import { assertAccountMayHoldRole } from "../../../lib/role-rules.js";
import {
  assignMemberRole,
  getMembership,
  listMembers,
  requireMembership as loadMembership,
} from "../team-store.js";
import { withTeamsErrors } from "./errors.js";

/**
 * Highest role plus the full set for a membership row.
 *
 * @param item - A roster row.
 * @returns Wire fields, or `undefined` when the row has no role.
 */
const roleFields = (
  item: { role?: unknown; roles?: unknown },
): { role: ReturnType<typeof highestRole>; roles: ReturnType<typeof rolesFromMembership> } | undefined => {
  const roles = rolesFromMembership(item);
  if (roles.length === 0) return undefined;
  return { role: highestRole(roles), roles };
};

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
        const roles = roleFields(member);
        if (roles === undefined) return undefined;
        return {
          userId: member.userId,
          ...roles,
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
    return json(200, { members: enriched.filter((member) => member !== undefined) });
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
  async ({ teamId, memberUserId, user, member: viewer }) => {
    const member = await getMembership(teamId, memberUserId);
    if (member === undefined) throw new Error("member_not_found");

    const profile = await getProfile(memberUserId);
    const guardianIds =
      profile?.accountKind === "minor" ? await listGuardianIds(memberUserId) : [];
    const showPhone =
      profile?.accountKind !== "minor" ||
      user.userId === memberUserId ||
      guardianIds.includes(user.userId);
    const showGuardians =
      viewer.roles.includes("team_admin") ||
      viewer.roles.includes("coach") ||
      guardianIds.includes(user.userId);
    const roles = roleFields(member);
    if (roles === undefined) throw new Error("member_not_found");
    return json(200, {
      userId: member.userId,
      ...roles,
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
            ...(showPhone && profile.phoneNumber !== undefined
              ? { phoneNumber: profile.phoneNumber }
              : {}),
            ...(showGuardians && guardianIds.length > 0 ? { guardianIds } : {}),
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
 * @param memberUserId - The roster member whose roles change.
 * @returns The updated membership.
 */
export const handleAssignRole = route(
  ["teamId", "memberUserId"],
  withTeamsErrors(),
  withBodyValidation(assignRoleBodySchema),
  requireUser(),
  requirePermission("assign_roles"),
  requireMembership(),
  async ({ teamId, memberUserId, member, body }) => {
    const target = await loadMembership(teamId, memberUserId);
    const targetRoles = rolesFromMembership(target);
    assertCallerCanGrantRoles(member.role, targetRoles);
    assertCallerCanGrantRoles(member.role, body.roles);
    for (const role of body.roles) {
      await assertAccountMayHoldRole(memberUserId, teamId, role);
    }
    const updated = await assignMemberRole(teamId, memberUserId, body.roles);
    const roles = roleFields(updated);
    if (roles === undefined) throw new Error("member_not_found");
    const profile = await getProfile(updated.userId);
    return json(200, {
      userId: updated.userId,
      ...roles,
      joinedAt: updated.joinedAt,
      ...(profile !== undefined ? { user: toUserProfile(profile) } : {}),
    });
  },
);
