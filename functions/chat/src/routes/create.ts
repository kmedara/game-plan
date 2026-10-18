/**
 * Create team channel and private chat routes.
 */

import { createPrivateChatBodySchema, createTeamChannelBodySchema } from '@gameplan/schemas';
import {
  requireMembership,
  requirePermission,
  requireTeam,
  requireUser,
  withTeamIdFromBody,
} from '../../../lib/guards.js';
import { json } from '../../../lib/http.js';
import {
  guardianPresentForAdultMinorChats,
  isMinorChatMembershipAllowed,
  requiredGuardianIds,
} from '@gameplan/rules';
import { route, withBodyValidation } from '../../../lib/pipeline.js';
import {
  createPrivateChat,
  createTeamChannel,
  loadChatParticipants,
} from '../chat-store.js';
import { listTeamMemberIds } from '../../../lib/team-roster.js';
import { withChatErrors } from './errors.js';

/**
 * Adds linked guardians when a minor would otherwise chat with an outside adult.
 *
 * @param memberIds - The proposed member ids.
 * @returns Those ids plus any required guardians.
 */
const withRequiredGuardians = async (memberIds: string[]): Promise<string[]> => [
  ...memberIds,
  ...requiredGuardianIds(await loadChatParticipants(memberIds)),
];

/**
 * Handles `POST /chat/channels`.
 *
 * @param event - The HTTP API event.
 * @returns The created team channel.
 */
export const handleCreateTeamChannel = route(
  'POST',
  '/chat/channels',
  withChatErrors(),
  requireUser(),
  withBodyValidation(createTeamChannelBodySchema),
  withTeamIdFromBody(),
  requireTeam(),
  requireMembership(),
  requirePermission('create_team_channels'),
  async ({ user, body }) => {
    const rosterIds = await listTeamMemberIds(body.teamId);
    if (!rosterIds.includes(user.userId)) throw new Error('not_a_member');
    const memberIds = await withRequiredGuardians(rosterIds);
    const participants = await loadChatParticipants(memberIds);
    if (!isMinorChatMembershipAllowed(participants)) throw new Error('minor_chat_rule_violated');
    if (!guardianPresentForAdultMinorChats(participants)) throw new Error('guardian_required');
    const created = await createTeamChannel({
      userId: user.userId,
      body,
      extraMemberIds: memberIds.filter((id) => !rosterIds.includes(id)),
    });
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
  'POST',
  '/chat/private',
  withChatErrors(),
  requireUser(),
  withBodyValidation(createPrivateChatBodySchema),
  async ({ user, body }) => {
    const requested = [...new Set([user.userId, ...body.memberIds])];
    if (requested.length < 2) throw new Error('invalid_body');
    const memberIds = await withRequiredGuardians(requested);
    const participants = await loadChatParticipants(memberIds);
    if (!isMinorChatMembershipAllowed(participants)) throw new Error('minor_chat_rule_violated');
    if (!guardianPresentForAdultMinorChats(participants)) throw new Error('guardian_required');
    const trimmedName = body.name?.trim();
    const created = await createPrivateChat({
      userId: user.userId,
      body: {
        memberIds: memberIds.filter((id) => id !== user.userId),
        ...(trimmedName !== undefined && trimmedName.length > 0 ? { name: trimmedName } : {}),
      },
    });
    return json(201, created);
  },
);
