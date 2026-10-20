/**
 * Chat route handlers.
 */

import type { HttpRoute } from '../../../lib/pipeline.js';
import { handleCreatePrivateChat, handleCreateTeamChannel } from './create.js';
import { handleListChats } from './list.js';
import { handleListMessages, handleSendMessage } from './messages.js';
import { handleCreatePoll, handleVotePoll } from './polls.js';
import { handleSearchUsers } from './search.js';

export {
  handleCreatePoll,
  handleCreatePrivateChat,
  handleCreateTeamChannel,
  handleListChats,
  handleListMessages,
  handleSearchUsers,
  handleSendMessage,
  handleVotePoll,
};

/** Every chat HTTP route, matched by method and path. */
export const httpRoutes: readonly HttpRoute[] = [
  handleListChats,
  handleCreateTeamChannel,
  handleCreatePrivateChat,
  handleSearchUsers,
  handleListMessages,
  handleSendMessage,
  handleCreatePoll,
  handleVotePoll,
];
