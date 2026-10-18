/**
 * Chat route handlers.
 */

import type { HttpRoute } from '../../../lib/pipeline.js';
import { handleCreatePrivateChat, handleCreateTeamChannel } from './create.js';
import { handleListChats } from './list.js';
import { handleListMessages, handleSendMessage } from './messages.js';
import { handleSearchUsers } from './search.js';

export {
  handleCreatePrivateChat,
  handleCreateTeamChannel,
  handleListChats,
  handleListMessages,
  handleSearchUsers,
  handleSendMessage,
};

/** Every chat HTTP route, matched by method and path. */
export const httpRoutes: readonly HttpRoute[] = [
  handleListChats,
  handleCreateTeamChannel,
  handleCreatePrivateChat,
  handleSearchUsers,
  handleListMessages,
  handleSendMessage,
];
