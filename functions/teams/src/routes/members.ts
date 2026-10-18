/**
 * Roster routes: list members and assign roles.
 */

import { assignRoleBodySchema } from "@gameplan/schemas";
import { assertCallerCanGrantRoles, highestRole, rolesFromMembership } from "@gameplan/rules";
import { getProfile, toUserProfile } from "../../../lib/auth/index.js";
import { isGuardianOf, listGuardianIds } from "../../../lib/guardians.js";
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

type Profile = NonNullable<Awaited<ReturnType<typeof getProfile>>>;

/**
 * Roster fields teammates can see.
 *
 * @param member - The roster row.
 * @param profile - The member's profile, when it exists.
 * @param showPhone - Whether the viewer may see the phone number.
 * @returns Wire fields, or `undefined` when the row has no role.
 */
const memberFields = (
  member: { userId: string; joinedAt: string; role?: unknown; roles?: unknown; positions?: string[] },
  profile: Profile | undefined,
  showPhone: boolean,
) => {
  const roles = roleFields(member);
  if (roles === undefined) return undefined;
  return {
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
        }
      : {}),
  };
};

/**
 * Handles `GET /teams/:teamId/members`.
 *
 * A minor's phone number is included only for that minor and their guardians.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @returns The roster with profile fields when available.
 */
export const handleListMembers = route(
  "GET",
  "/teams/:teamId/members",
  withTeamsErrors(),
  requireUser(),
  requireMembership(),
  async ({ teamId, user }) => {
    const members = await listMembers(teamId);
    const enriched = await Promise.all(
      members.map(async (member) => {
        const profile = await getProfile(member.userId);
        const showPhone =
          profile?.accountKind !== "minor" ||
          user.userId === member.userId ||
          (profile.phoneNumber !== undefined && (await isGuardianOf(user.userId, member.userId)));
        return memberFields(member, profile, showPhone);
      }),
    );
    return json(200, { members: enriched.filter((member) => member !== undefined) });
  },
);

/**
 * Handles `GET /teams/:teamId/members/:memberUserId`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @param memberUserId - The roster member to view.
 * @returns Profile fields teammates can see on this team.
 */
export const handleGetMember = route(
  "GET",
  "/teams/:teamId/members/:memberUserId",
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
    const fields = memberFields(member, profile, showPhone);
    if (fields === undefined) throw new Error("member_not_found");
    return json(200, {
      ...fields,
      ...(profile !== undefined && showGuardians && guardianIds.length > 0 ? { guardianIds } : {}),
    });
  },
);

/**
 * Handles `PATCH /teams/:teamId/members/:memberUserId`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @param memberUserId - The roster member whose roles change.
 * @returns The updated membership.
 */
export const handleAssignRole = route(
  "PATCH",
  "/teams/:teamId/members/:memberUserId",
  withTeamsErrors(),
  requireUser(),
  withBodyValidation(assignRoleBodySchema),
  requireMembership(),
  requirePermission("assign_roles"),
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
