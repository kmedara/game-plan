/**
 * Invite create, list, lookup, and accept routes.
 */

import { createInviteBodySchema, sendInviteBodySchema, toE164Phone } from '@gameplan/schemas';
import { assertCallerCanGrant } from '@gameplan/rules';
import { TEAM_ROLES, type TeamRole } from '@gameplan/types';
import { requireMembership, requirePermission, requireUser } from '../../../lib/auth/index.js';
import { getProfile } from '../../../lib/auth/profile.js';
import { badRequest, json } from '../../../lib/http.js';
import { route, withBodyValidation } from '../../../lib/pipeline.js';
import { assertAccountMayHoldRole } from '../../../lib/role-rules.js';
import { awsInviteDelivery } from '../invite-delivery.js';
import { inviteEmail, inviteTextMessage, messageName } from '../invite-message.js';
import {
  acceptInvite,
  countInviteSend,
  createInvite,
  deleteInvite,
  getInviteByCode,
  listInvites,
  requireTeam,
} from '../team-store.js';
import { withTeamsErrors } from './errors.js';

/** One plain address: no lists, names, or spaces that could add recipients. */
const SINGLE_EMAIL = /^[^\s@,;<>"()]+@[^\s@,;<>"()]+\.[^\s@,;<>"()]+$/u;

/**
 * Website invite page for a code. The link opens the app when it is installed.
 *
 * @param code - The invite code.
 * @returns The absolute URL.
 */
const invitePageUrl = (code: string): string =>
  `${(process.env.CLIENT_ORIGIN ?? 'http://localhost:4200').replace(/\/+$/u, '')}/invite/${encodeURIComponent(code)}`;

/**
 * Checks and normalizes the recipient for a channel.
 *
 * Texts go only to US and Canadian numbers: a toll-free number cannot send
 * elsewhere, and this keeps international SMS fraud off the account.
 *
 * @param channel - Email or text.
 * @param to - The address or phone number from the request.
 * @returns The address, or the number in E.164.
 * @throws `invalid_recipient`, or `text_country_unsupported` for a number outside +1.
 */
const recipientFor = (channel: 'email' | 'text', to: string): string => {
  if (channel === 'email') {
    const email = to.trim().toLowerCase();
    if (email.length > 254 || !SINGLE_EMAIL.test(email)) throw new Error('invalid_recipient');
    return email;
  }
  const phone = toE164Phone(to);
  if (phone === undefined) throw new Error('invalid_recipient');
  if (!phone.startsWith('+1')) throw new Error('text_country_unsupported');
  return phone;
};

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
 * Handles `POST /teams/:teamId/invites/send`.
 *
 * GamePlan emails or texts the role's code from its own address or number. The
 * email shows the inviter's name and replies go to them. Each send counts
 * against the team's and the sender's daily limits.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @returns The channel, code, and role that were sent.
 */
export const handleSendInvite = route(
  'POST',
  '/teams/:teamId/invites/send',
  withTeamsErrors(),
  requireUser(),
  withBodyValidation(sendInviteBodySchema),
  requireMembership(),
  requirePermission('invite_members'),
  async ({ teamId, user, member, body }) => {
    const role = body.role ?? 'player';
    assertCallerCanGrant(member.role, role);
    const recipient = recipientFor(body.channel, body.to);
    // Before the limit is spent, so the app can fall back to the person's own app.
    if (!awsInviteDelivery.configured(body.channel)) {
      throw new Error(body.channel === 'email' ? 'email_not_configured' : 'text_not_configured');
    }
    const [team, profile] = await Promise.all([requireTeam(teamId), getProfile(user.userId)]);
    const invite = await createInvite({ teamId, createdBy: user.userId, role });
    await countInviteSend(teamId, user.userId);

    const message = {
      locale: body.locale ?? 'en',
      // Reads the same in either language when a profile has no name.
      inviterName: profile?.displayName ?? 'GamePlan',
      teamName: team.name,
      role,
      code: invite.code,
      url: invitePageUrl(invite.code),
    } as const;
    if (body.channel === 'email') {
      const replyTo = profile?.email?.trim().toLowerCase();
      await awsInviteDelivery.email({
        ...inviteEmail(message),
        to: recipient,
        inviterName: messageName(message.inviterName),
        ...(replyTo !== undefined && SINGLE_EMAIL.test(replyTo) ? { replyTo } : {}),
      });
    } else {
      await awsInviteDelivery.text({ to: recipient, body: inviteTextMessage(message) });
    }
    return json(200, { channel: body.channel, code: invite.code, role });
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
