/**
 * Create team channel and private chat routes.
 */

import { createPrivateChatBodySchema, createTeamChannelBodySchema } from '@gameplan/schemas';
import {
  requirePermission,
  requireUser,
  withTeamIdFromBody,
} from '../../../lib/guards.js';
import { json } from '../../../lib/http.js';
import { route, withBodyValidation } from '../../../lib/pipeline.js';
import { createPrivateChat, createTeamChannel } from '../chat-store.js';
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
  requirePermission('create_team_channels'),
  async ({ user, body }) => {
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
    const created = await createPrivateChat({ userId: user.userId, body });
    return json(201, created);
  },
);
