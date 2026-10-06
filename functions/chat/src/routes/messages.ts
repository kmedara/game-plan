/**
 * Message history and send routes.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { messageHistoryQuerySchema, sendMessageBodySchema } from '@gameplan/schemas';
import { json, withBodyValidation, withQueryValidation } from '../../../lib/http.js';
import { requireUser } from '../../../lib/auth/index.js';

import { listMessages, requireChatMembership, sendMessage } from '../chat-store.js';

import { withChatErrors } from './errors.js';

/**
 * Handles `GET /chat/:chatId/messages`.
 *
 * @param event - The HTTP API event.
 * @param chatId - The chat id from the path.
 * @returns Newest-first messages and an optional page cursor.
 */
export const handleListMessages = (
  event: APIGatewayProxyEventV2,
  chatId: string,
): Promise<APIGatewayProxyStructuredResultV2> =>
  withChatErrors(async () =>
    withQueryValidation(messageHistoryQuerySchema, async (event, query) => {
      const user = await requireUser(event);
      await requireChatMembership(chatId, user.userId);
      const page = await listMessages(chatId, query);
      return json(200, page);
    })(event),
  );

/**
 * Handles `POST /chat/:chatId/messages`.
 *
 * @param event - The HTTP API event.
 * @param chatId - The chat id from the path.
 * @returns The persisted message.
 */
export const handleSendMessage = (
  event: APIGatewayProxyEventV2,
  chatId: string,
): Promise<APIGatewayProxyStructuredResultV2> =>
  withChatErrors(async () =>
    withBodyValidation(sendMessageBodySchema, async (event, body) => {
      const user = await requireUser(event);
      const message = await sendMessage({
        chatId,
        userId: user.userId,
        body,
      });
      return json(201, message);
    })(event),
  );
