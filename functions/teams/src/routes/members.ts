/**
 * Roster routes: list members and assign roles.
 */

import { assignRoleBodySchema } from "@gameplan/schemas";
import { assertCallerCanGrantRoles, highestRole, rolesFromMembership } from "@gameplan/rules";
import type { TeamRole } from "@gameplan/types";
import { getProfile } from "../../../lib/auth/index.js";
import { listGuardianIds } from "../../../lib/guardians.js";
import { getMedicalInfo, logMedicalRead } from "../../../lib/medical.js";
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
 * @param guardianIds - A minor's linked guardians. Only whether there are any is sent.
 * @returns Wire fields, or `undefined` when the row has no role.
 */
const memberFields = (
  member: { userId: string; joinedAt: string; role?: unknown; roles?: unknown; positions?: string[] },
  profile: Profile | undefined,
  showPhone: boolean,
  guardianIds: readonly string[],
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
          ...(profile.accountKind === "minor" ? { hasGuardian: guardianIds.length > 0 } : {}),
        }
      : {}),
  };
};

/**
 * Whether the viewer may see a member's phone number.
 *
 * An adult's number is shown to teammates. A minor's is shown only to that
 * minor and their guardians.
 *
 * @param viewerId - The caller.
 * @param memberId - The member being shown.
 * @param profile - The member's profile, when it exists.
 * @param guardianIds - The member's linked guardians.
 * @returns `true` when the number may be included.
 */
const showsPhone = (
  viewerId: string,
  memberId: string,
  profile: Profile | undefined,
  guardianIds: readonly string[],
): boolean =>
  profile?.accountKind !== "minor" || viewerId === memberId || guardianIds.includes(viewerId);

/**
 * One member as the viewer may see them on this team.
 *
 * Team admins, coaches, and the member's own guardians also get the guardian ids.
 *
 * @param member - The roster row.
 * @param viewerId - The caller.
 * @param viewerRoles - The caller's roles on this team.
 * @returns The member's wire fields.
 * @throws `member_not_found` when the row has no role.
 */
const memberDetail = async (
  member: Parameters<typeof memberFields>[0],
  viewerId: string,
  viewerRoles: readonly TeamRole[],
) => {
  const profile = await getProfile(member.userId);
  const guardianIds =
    profile?.accountKind === "minor" ? await listGuardianIds(member.userId) : [];
  const fields = memberFields(
    member,
    profile,
    showsPhone(viewerId, member.userId, profile, guardianIds),
    guardianIds,
  );
  if (fields === undefined) throw new Error("member_not_found");
  const showGuardians =
    viewerRoles.includes("team_admin") ||
    viewerRoles.includes("coach") ||
    guardianIds.includes(viewerId);
  return {
    ...fields,
    ...(profile !== undefined && showGuardians && guardianIds.length > 0 ? { guardianIds } : {}),
  };
};

/**
 * Handles `GET /teams/:teamId/members`.
 *
 * A minor's phone number is included only for that minor and their guardians.
 * Each minor says whether any guardian is linked, but not who.
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
        // One guardian read per minor answers both the phone rule and hasGuardian.
        const guardianIds =
          profile?.accountKind === "minor" ? await listGuardianIds(member.userId) : [];
        return memberFields(
          member,
          profile,
          showsPhone(user.userId, member.userId, profile, guardianIds),
          guardianIds,
        );
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
    return json(200, await memberDetail(member, user.userId, viewer.roles));
  },
);

/**
 * Handles `GET /teams/:teamId/members/:memberUserId/medical`.
 *
 * Staff with `view_medical_info` read a member's emergency info and their
 * guardians' phone numbers. A minor never reads another member's info, even
 * with the permission. Every read is logged on the team.
 *
 * @returns The record and the guardians to call.
 */
export const handleGetMemberMedical = route(
  "GET",
  "/teams/:teamId/members/:memberUserId/medical",
  withTeamsErrors(),
  requireUser(),
  requireMembership(),
  requirePermission("view_medical_info"),
  async ({ teamId, memberUserId, user }) => {
    const caller = await getProfile(user.userId);
    if (caller?.accountKind !== "adult") throw new Error("forbidden");
    if ((await getMembership(teamId, memberUserId)) === undefined) throw new Error("member_not_found");
    const guardianIds = await listGuardianIds(memberUserId);
    const [info, guardians] = await Promise.all([
      getMedicalInfo(memberUserId),
      Promise.all(guardianIds.map((id) => getProfile(id))),
    ]);
    await logMedicalRead({ teamId, viewerId: user.userId, memberId: memberUserId });
    return json(200, {
      info,
      guardians: guardians.flatMap((guardian) =>
        guardian === undefined
          ? []
          : [
              {
                userId: guardian.userId,
                displayName: guardian.displayName,
                ...(guardian.phoneNumber !== undefined ? { phoneNumber: guardian.phoneNumber } : {}),
              },
            ],
      ),
    });
  },
);

/**
 * Handles `PATCH /teams/:teamId/members/:memberUserId`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @param memberUserId - The roster member whose roles change.
 * @returns The updated member, as `GET /teams/:teamId/members/:memberUserId` shows them.
 */
export const handleAssignRole = route(
  "PATCH",
  "/teams/:teamId/members/:memberUserId",
  withTeamsErrors(),
  requireUser(),
  withBodyValidation(assignRoleBodySchema),
  requireMembership(),
  requirePermission("assign_roles"),
  async ({ teamId, memberUserId, member, user, body }) => {
    const target = await loadMembership(teamId, memberUserId);
    const targetRoles = rolesFromMembership(target);
    assertCallerCanGrantRoles(member.role, targetRoles);
    assertCallerCanGrantRoles(member.role, body.roles);
    for (const role of body.roles) {
      await assertAccountMayHoldRole(memberUserId, teamId, role);
    }
    const updated = await assignMemberRole(teamId, memberUserId, body.roles);
    return json(200, await memberDetail(updated, user.userId, member.roles));
  },
);
