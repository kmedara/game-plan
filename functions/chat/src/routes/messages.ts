/**
 * Message history and send routes.
 */

import { messageHistoryQuerySchema, sendMessageBodySchema } from '@gameplan/schemas';
import { requireUser } from '../../../lib/auth/index.js';
import { json } from '../../../lib/http.js';
import { route, withBodyValidation, withQueryValidation } from '../../../lib/pipeline.js';
import { listMessages, requireChatMembership, sendMessage } from '../chat-store.js';
import { withChatErrors } from './errors.js';

/**
 * Handles `GET /chat/:chatId/messages`.
 *
 * @param event - The HTTP API event.
 * @param chatId - The chat id from the path.
 * @returns Newest-first messages and an optional page cursor.
 */
export const handleListMessages = route(
  ['chatId'],
  withChatErrors(),
  withQueryValidation(messageHistoryQuerySchema),
  requireUser(),
  async ({ chatId, user, query }) => {
    await requireChatMembership(chatId, user.userId);
    const page = await listMessages(chatId, query);
    return json(200, page);
  },
);

/**
 * Handles `POST /chat/:chatId/messages`.
 *
 * @param event - The HTTP API event.
 * @param chatId - The chat id from the path.
 * @returns The persisted message.
 */
export const handleSendMessage = route(
  ['chatId'],
  withChatErrors(),
  withBodyValidation(sendMessageBodySchema),
  requireUser(),
  async ({ chatId, user, body }) => {
    const message = await sendMessage({
      chatId,
      userId: user.userId,
      body,
    });
    return json(201, message);
  },
);
