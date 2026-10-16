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
import { guardianPresentForAdultMinorChats, isMinorChatMembershipAllowed } from '@gameplan/rules';
import { route, withBodyValidation } from '../../../lib/pipeline.js';
import {
  createPrivateChat,
  createTeamChannel,
  listTeamMemberIds,
  loadChatParticipants,
} from '../chat-store.js';
import { withChatErrors } from './errors.js';

/**
 * Adds linked guardians when a minor would otherwise chat with an outside adult.
 *
 * @param memberIds - The proposed member ids.
 * @returns Those ids plus any required guardians.
 */
const withRequiredGuardians = async (memberIds: string[]): Promise<string[]> => {
  const participants = await loadChatParticipants(memberIds);
  const next = new Set(memberIds);
  for (const minor of participants) {
    if (minor.accountKind !== 'minor') continue;
    const guardians = minor.guardianIds ?? [];
    const outsideAdult = participants.some(
      (member) => member.accountKind === 'adult' && !guardians.includes(member.userId),
    );
    if (!outsideAdult) continue;
    for (const guardianId of guardians) next.add(guardianId);
  }
  return [...next];
};

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
  withChatErrors(),
  withBodyValidation(createPrivateChatBodySchema),
  requireUser(),
  async ({ user, body }) => {
    const requested = [...new Set([user.userId, ...body.memberIds])];
    if (requested.length < 2) throw new Error('invalid_body');
    const memberIds = await withRequiredGuardians(requested);
    const participants = await loadChatParticipants(memberIds);
    if (!isMinorChatMembershipAllowed(participants)) throw new Error('minor_chat_rule_violated');
    if (!guardianPresentForAdultMinorChats(participants)) throw new Error('guardian_required');
    const created = await createPrivateChat({
      userId: user.userId,
      body: { memberIds: memberIds.filter((id) => id !== user.userId) },
    });
    return json(201, created);
  },
);
