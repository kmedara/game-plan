/**
 * Invite create, list, lookup, and accept routes.
 */

import { createInviteBodySchema } from '@gameplan/schemas';
import { assertCallerCanGrant } from '@gameplan/rules';
import { TEAM_ROLES, type TeamRole } from '@gameplan/types';
import { requireMembership, requirePermission, requireUser } from '../../../lib/auth/index.js';
import { badRequest, json } from '../../../lib/http.js';
import { route, withBodyValidation } from '../../../lib/pipeline.js';
import { assertAccountMayHoldRole } from '../../../lib/role-rules.js';
import {
  acceptInvite,
  createInvite,
  deleteInvite,
  getInviteByCode,
  listInvites,
  requireTeam,
} from '../team-store.js';
import { withTeamsErrors } from './errors.js';

/**
 * Handles `POST /teams/:teamId/invites`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @returns The new invite code.
 */
export const handleCreateInvite = route(
  'POST',
  '/teams/:teamId/invites',
  withTeamsErrors(),
  requireUser(),
  withBodyValidation(createInviteBodySchema),
  requireMembership(),
  requirePermission('invite_members'),
  async ({ teamId, user, member, body }) => {
    const role = body.role ?? 'player';
    assertCallerCanGrant(member.role, role);
    const invite = await createInvite({
      teamId,
      createdBy: user.userId,
      role,
    });

    return json(201, {
      code: invite.code,
      teamId: invite.teamId,
      role: invite.role,
      createdAt: invite.createdAt,
    });
  },
);

/**
 * Handles `GET /teams/:teamId/invites`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @returns Active invites for the team.
 */
export const handleListInvites = route(
  'GET',
  '/teams/:teamId/invites',
  withTeamsErrors(),
  requireUser(),
  requireMembership(),
  requirePermission('invite_members'),
  async ({ teamId }) => {
    await requireTeam(teamId);
    const invites = await listInvites(teamId);
    return json(200, {
      invites: invites.map((invite) => ({
        code: invite.code,
        teamId: invite.teamId,
        role: invite.role,
        createdBy: invite.createdBy,
        createdAt: invite.createdAt,
      })),
    });
  },
);

/**
 * Handles `DELETE /teams/:teamId/invites/:role`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @param role - The role whose invite code to delete.
 * @returns An empty response when the code is gone.
 */
export const handleDeleteInvite = route(
  'DELETE',
  '/teams/:teamId/invites/:role',
  withTeamsErrors(),
  requireUser(),
  requireMembership(),
  requirePermission('invite_members'),
  async ({ teamId, role, member }) => {
    if (!TEAM_ROLES.includes(role as TeamRole)) return badRequest('invalid_body');
    const inviteRole = role as TeamRole;
    assertCallerCanGrant(member.role, inviteRole);
    await deleteInvite(teamId, inviteRole);
    return { statusCode: 204 };
  },
);

/**
 * Handles `GET /teams/invite/:code`.
 *
 * @param event - The HTTP API event.
 * @param code - The invite code from the path.
 * @returns Invite metadata and the team name.
 */
export const handleGetInvite = route(
  'GET',
  '/teams/invite/:code',
  withTeamsErrors(),
  requireUser(),
  async ({ code }) => {
    const invite = await getInviteByCode(code);
    const team = await requireTeam(invite.teamId);
    return json(200, {
      code: invite.code,
      teamId: invite.teamId,
      teamName: team.name,
      role: invite.role,
      createdAt: invite.createdAt,
    });
  },
);

/**
 * Handles `POST /teams/invite/:code/accept`.
 *
 * @param event - The HTTP API event.
 * @param code - The invite code from the path.
 * @returns The team membership created by accepting.
 */
export const handleAcceptInvite = route(
  'POST',
  '/teams/invite/:code/accept',
  withTeamsErrors(),
  requireUser(),
  async ({ code, user }) => {
    const invite = await getInviteByCode(code);
    await assertAccountMayHoldRole(user.userId, invite.teamId, invite.role);
    const { team, member } = await acceptInvite(code, user.userId);
    return json(200, {
      teamId: team.teamId,
      name: team.name,
      timeZone: team.timeZone,
      defaultChatId: team.defaultChatId,
      role: member.role,
      joinedAt: member.joinedAt,
    });
  },
);
