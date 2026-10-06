/**
 * Roster routes: list members and assign roles.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { getProfile, toUserProfile, requirePermission, requireUser } from '../../../lib/auth/index.js';
import { assignRoleBodySchema } from '@gameplan/schemas';
import { json, withBodyValidation } from '../../../lib/http.js';
import { assignMemberRole, listMembers, requireMembership } from '../team-store.js';

import { withTeamsErrors } from './errors.js';

/**
 * Handles `GET /teams/:teamId/members`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @returns The roster with basic profile fields when available.
 */
export const handleListMembers = (
  event: APIGatewayProxyEventV2,
  teamId: string,
): Promise<APIGatewayProxyStructuredResultV2> =>
  withTeamsErrors(async () => {
    const user = await requireUser(event);
    await requireMembership(teamId, user.userId);
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
  });

/**
 * Handles `PATCH /teams/:teamId/members/:userId`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @param memberUserId - The roster member whose role changes.
 * @returns The updated membership.
 */
export const handleAssignRole = (
  event: APIGatewayProxyEventV2,
  teamId: string,
  memberUserId: string,
): Promise<APIGatewayProxyStructuredResultV2> =>
  withTeamsErrors(async () =>
    withBodyValidation(assignRoleBodySchema, async (event, body) => {
      const user = await requireUser(event);
      await requirePermission(user.userId, teamId, 'assign_roles');

      const member = await assignMemberRole(teamId, memberUserId, body.role);
      const profile = await getProfile(member.userId);
      return json(200, {
        userId: member.userId,
        role: member.role,
        joinedAt: member.joinedAt,
        ...(profile !== undefined ? { user: toUserProfile(profile) } : {}),
      });
    })(event),
  );
