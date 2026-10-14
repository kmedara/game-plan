/**
 * Create team channel and private chat routes.
 */

import { createPrivateChatBodySchema, createTeamChannelBodySchema } from '@gameplan/schemas';
import {
  requirePermission,
  requireTeam,
  requireUser,
  withTeamIdFromBody,
} from '../../../lib/guards.js';
import { json } from '../../../lib/http.js';
import { isMinorChatMembershipAllowed } from '@gameplan/rules';
import { route, withBodyValidation } from '../../../lib/pipeline.js';
import {
  createPrivateChat,
  createTeamChannel,
  listTeamMemberIds,
  loadChatParticipants,
} from '../chat-store.js';
import { withChatErrors } from './errors.js';

/**
 * Handles `POST /chat/channels`.
 *
 * @param event - The HTTP API event.
 * @returns The created team channel.
 */
export const handleCreateTeamChannel = route(
  withChatErrors(),
  withBodyValidation(createTeamChannelBodySchema),
  requireUser(),
  withTeamIdFromBody(),
  requireTeam(),
  requirePermission('create_team_channels'),
  async ({ user, body }) => {
    const memberIds = await listTeamMemberIds(body.teamId);
    if (!memberIds.includes(user.userId)) throw new Error('not_a_member');
    const participants = await loadChatParticipants(memberIds);
    if (!isMinorChatMembershipAllowed(participants)) {
      throw new Error('minor_chat_rule_violated');
    }
    const created = await createTeamChannel({ userId: user.userId, body });
    return json(201, created);
  },
);

/**
 * Handles `POST /chat/private`.
 *
 * @param event - The HTTP API event.
 * @returns The created private chat.
 */
export const handleCreatePrivateChat = route(
  withChatErrors(),
  withBodyValidation(createPrivateChatBodySchema),
  requireUser(),
  async ({ user, body }) => {
    const memberIds = [...new Set([user.userId, ...body.memberIds])];
    if (memberIds.length < 2) throw new Error('invalid_body');
    const participants = await loadChatParticipants(memberIds);
    if (!isMinorChatMembershipAllowed(participants)) {
      throw new Error('minor_chat_rule_violated');
    }
    const created = await createPrivateChat({ userId: user.userId, body });
    return json(201, created);
  },
);
