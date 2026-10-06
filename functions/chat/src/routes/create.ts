/**
 * Create team channel and private chat routes.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { createPrivateChatBodySchema, createTeamChannelBodySchema } from '@gameplan/schemas';
import { json, withBodyValidation } from '../../../lib/http.js';
import { requirePermission, requireUser } from '../../../lib/auth/index.js';

import { createPrivateChat, createTeamChannel } from '../chat-store.js';

import { withChatErrors } from './errors.js';

/**
 * Handles `POST /chat/channels`.
 *
 * @param event - The HTTP API event.
 * @returns The created team channel.
 */
export const handleCreateTeamChannel = (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> =>
  withChatErrors(async () =>
    withBodyValidation(createTeamChannelBodySchema, async (event, body) => {
      const user = await requireUser(event);
      await requirePermission(user.userId, body.teamId, 'create_team_channels');
      const created = await createTeamChannel({ userId: user.userId, body });
      return json(201, created);
    })(event),
  );

/**
 * Handles `POST /chat/private`.
 *
 * @param event - The HTTP API event.
 * @returns The created private chat.
 */
export const handleCreatePrivateChat = (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> =>
  withChatErrors(async () =>
    withBodyValidation(createPrivateChatBodySchema, async (event, body) => {
      const user = await requireUser(event);
      const created = await createPrivateChat({ userId: user.userId, body });
      return json(201, created);
    })(event),
  );
