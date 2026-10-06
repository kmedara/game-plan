/**
 * List chats route.
 */

import { requireUser } from '../../../lib/auth/index.js';
import { json } from '../../../lib/http.js';
import { route } from '../../../lib/pipeline.js';
import { listUserChats } from '../chat-store.js';
import { withChatErrors } from './errors.js';

/**
 * Handles `GET /chat`.
 *
 * @param event - The HTTP API event.
 * @returns Chats the caller belongs to.
 */
export const handleListChats = route(
  withChatErrors(),
  requireUser(),
  async ({ user }) => {
    const chats = await listUserChats(user.userId);
    return json(200, { chats });
  },
);
