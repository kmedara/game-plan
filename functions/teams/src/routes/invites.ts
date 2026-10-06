/**
 * Invite create, list, lookup, and accept routes.
 */

import { createInviteBodySchema } from '@gameplan/schemas';
import { requirePermission, requireUser } from '../../../lib/auth/index.js';
import { json } from '../../../lib/http.js';
import { route, withBodyValidation } from '../../../lib/pipeline.js';
import {
  acceptInvite,
  createInvite,
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
  ['teamId'],
  withTeamsErrors(),
  withBodyValidation(createInviteBodySchema),
  requireUser(),
  requirePermission('invite_members'),
  async ({ teamId, user, body }) => {
    const invite = await createInvite({
      teamId,
      createdBy: user.userId,
      role: body.role ?? 'player',
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
  ['teamId'],
  withTeamsErrors(),
  requireUser(),
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
 * Handles `GET /teams/invite/:code`.
 *
 * @param event - The HTTP API event.
 * @param code - The invite code from the path.
 * @returns Invite metadata and the team name.
 */
export const handleGetInvite = route(
  ['code'],
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
  ['code'],
  withTeamsErrors(),
  requireUser(),
  async ({ code, user }) => {
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
